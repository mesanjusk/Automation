// Starts normal installed Chrome as an independent OS process with a dedicated
// user-data directory and a local DevTools port. Authentication happens before
// Playwright attaches. After the user confirms login, Playwright connects over
// CDP only to capture storageState for the BrowserProfile.
//
// Usage: npm run connect-browser -- --profile=<browserProfileId>
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import net from "node:net";
import { chromium } from "playwright";
import { connectToDatabase, disconnectDatabase, BrowserProfile } from "@bos/database";
import { encryptJSON } from "@bos/security";

function getArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function findChrome(): string | undefined {
  const candidates = process.platform === "win32"
    ? [
        path.join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a local debugging port"));
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForDevTools(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/json/version`;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Chrome DevTools endpoint did not become available.");
}

async function main() {
  const profileId = getArg("profile");
  if (!profileId) {
    console.error("Usage: npm run connect-browser -- --profile=<browserProfileId>");
    process.exit(1);
  }

  const chromePath = findChrome();
  if (!chromePath) throw new Error("Google Chrome was not found. Install normal Google Chrome and try again.");

  await connectToDatabase();
  const profile = await BrowserProfile.findById(profileId);
  if (!profile) throw new Error(`Browser profile ${profileId} not found.`);

  const port = await freePort();
  const userDataDir = path.join(os.homedir(), ".automation-os", "chrome-connect", profileId);
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log(`Starting normal Google Chrome for profile "${profile.name}"...`);
  console.log(`Chrome data directory: ${userDataDir}`);
  console.log("Sign in manually BEFORE automation attaches:");
  console.log("  1. Open https://chatgpt.com and sign in.");
  console.log("  2. Open https://labs.google/fx/tools/flow in a second tab and sign in.");
  console.log("  3. Confirm both sites work.");
  console.log("  4. Return here and press Enter. Keep Chrome open.");

  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://chatgpt.com/",
  ], {
    detached: false,
    stdio: "ignore",
  });

  chrome.on("error", (err) => console.error("Chrome process error:", err.message));
  await waitForDevTools(port);

  const rl = readline.createInterface({ input, output });
  await rl.question("Press Enter only after ChatGPT + Google Flow are both logged in... ");
  rl.close();

  console.log("Attaching to the already-authenticated Chrome session...");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Could not access the connected Chrome browser context.");

  const state = await context.storageState();
  profile.encryptedStorageState = encryptJSON(state);
  profile.status = "ready";
  profile.lastUsedAt = new Date();
  await profile.save();

  console.log(`Saved session for profile "${profile.name}". Dashboard status is now READY.`);
  console.log("You can close this dedicated Chrome window now.");

  await browser.close();
  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  try { await disconnectDatabase(); } catch {}
  process.exit(1);
});

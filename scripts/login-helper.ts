// Opens installed Google Chrome (not Playwright's bundled Chromium) so you can
// authenticate normally, then saves cookies + localStorage onto a BrowserProfile.
// A dedicated Chrome user-data directory is used so this never touches or locks
// your everyday Chrome profile.
//
// Usage: npm run login-helper -- --profile=<browserProfileId> [--url=https://chatgpt.com/]
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { chromium } from "playwright";
import { connectToDatabase, disconnectDatabase, BrowserProfile } from "@bos/database";
import { encryptJSON, decryptJSON } from "@bos/security";

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

async function main() {
  const profileId = getArg("profile");
  const startUrl = getArg("url") ?? "https://chatgpt.com/";
  if (!profileId) {
    console.error("Usage: npm run login-helper -- --profile=<browserProfileId> [--url=https://chatgpt.com/]");
    process.exit(1);
  }

  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Google Chrome was not found. Install normal Google Chrome and try again.");
  }

  await connectToDatabase();
  const profile = await BrowserProfile.findById(profileId).select("+encryptedStorageState");
  if (!profile) throw new Error(`Browser profile ${profileId} not found.`);

  const existingState = profile.encryptedStorageState ? decryptJSON(profile.encryptedStorageState) : undefined;
  const userDataDir = path.join(os.homedir(), ".automation-os", "chrome-profiles", profileId);
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log(`Opening installed Google Chrome for profile "${profile.name}"...`);
  console.log(`Dedicated Chrome data: ${userDataDir}`);
  console.log("1. Sign into ChatGPT in this Chrome window.");
  console.log("2. Open a new tab, go to https://labs.google/fx/tools/flow and sign into Google Flow.");
  console.log("3. Confirm both sites work, then RETURN TO THIS TERMINAL and press Enter.");
  console.log("Do not close Chrome before pressing Enter.");

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath,
    headless: false,
    viewport: profile.viewport,
    locale: profile.locale,
    timezoneId: profile.timezone,
    userAgent: profile.userAgent,
  });

  // Seed an already-saved automation session into the dedicated Chrome profile when possible.
  if (existingState && typeof existingState === "object" && Array.isArray((existingState as { cookies?: unknown[] }).cookies)) {
    await context.addCookies((existingState as { cookies: Parameters<typeof context.addCookies>[0] }).cookies);
  }

  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  await page.goto(startUrl, { waitUntil: "domcontentloaded" });

  const rl = readline.createInterface({ input, output });
  await rl.question("Press Enter after ChatGPT + Google Flow are both logged in... ");
  rl.close();

  // Capture while Chrome is alive. This produces Playwright storageState that
  // the Render worker can later decrypt and load into its automation context.
  const state = await context.storageState();
  profile.encryptedStorageState = encryptJSON(state);
  profile.status = "ready";
  profile.lastUsedAt = new Date();
  await profile.save();
  console.log(`Saved session for profile "${profile.name}". Status is now READY.`);

  await context.close();
  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  try { await disconnectDatabase(); } catch {}
  process.exit(1);
});

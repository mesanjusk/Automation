// Starts your normal Google Chrome with a DevTools port and leaves it running,
// so the worker can attach to it instead of launching its own browser.
//
// This exists because Google refuses its sign-in flow inside an automated
// browser — "this browser or app may not be secure". The fix is not to make
// automation look less automated; it is to stop signing in inside automation
// at all. You sign in here, normally, in real Chrome. The worker then joins
// the browser you are already signed in to.
//
// Usage:
//   npm run chrome                 # then, in another terminal, start the worker
//   npm run chrome -- --port=9222
import "dotenv/config";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

function getArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function findChrome(): string | undefined {
  const explicit = process.env.CHROME_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates =
    process.platform === "win32"
      ? [
          path.join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
          path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
          path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

async function waitForDevTools(port: number): Promise<string> {
  const url = `http://127.0.0.1:${port}/json/version`;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const info = (await response.json()) as { Browser?: string };
        return info.Browser ?? "Chrome";
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Chrome's DevTools endpoint never came up on port ${port}.`);
}

async function main() {
  const port = Number(getArg("port") ?? process.env.CHROME_DEBUG_PORT ?? 9222);
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error(
      "Google Chrome was not found. Install it, or point CHROME_PATH at the executable."
    );
  }

  // A dedicated user-data directory, so this never touches, locks or logs out
  // your everyday Chrome profile. Sign in once here and it persists across runs.
  const userDataDir = path.join(os.homedir(), ".automation-os", "chrome-session");
  fs.mkdirSync(userDataDir, { recursive: true });

  const chrome = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://chatgpt.com/",
      "https://labs.google/fx/tools/flow",
    ],
    { stdio: "ignore" }
  );
  chrome.on("error", (err) => console.error("Chrome failed to start:", err.message));
  chrome.on("exit", (code) => {
    console.log(`\nChrome exited (code ${code}). The worker can no longer attach.`);
    process.exit(code ?? 0);
  });

  const version = await waitForDevTools(port);
  const cdpUrl = `http://127.0.0.1:${port}`;

  console.log("");
  console.log("==========================================================");
  console.log(`  ${version} is running with a DevTools port.`);
  console.log(`  Profile directory: ${userDataDir}`);
  console.log("");
  console.log("  1. In the Chrome window that just opened, sign in to:");
  console.log("       - ChatGPT");
  console.log("       - Google Flow  (a normal Google sign-in — it works here,");
  console.log("         because this is your real Chrome, not an automated one)");
  console.log("");
  console.log("  2. Leave this window open, and leave this terminal running.");
  console.log("");
  console.log("  3. In another terminal, start the worker with:");
  console.log("");
  console.log(`       BROWSER_CDP_URL=${cdpUrl} npm run worker`);
  console.log("");
  console.log(`     (Windows PowerShell:  $env:BROWSER_CDP_URL="${cdpUrl}"; npm run worker)`);
  console.log("     Or add this line to .env:");
  console.log(`       BROWSER_CDP_URL=${cdpUrl}`);
  console.log("");
  console.log("  Press Ctrl+C here when you are done to close this Chrome.");
  console.log("==========================================================");
  console.log("");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

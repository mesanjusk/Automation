// Starts real Google Chrome with a DevTools port and leaves it running, so the
// worker can attach to it instead of launching its own browser.
//
// This exists because Google refuses its sign-in flow inside an automated
// browser — "this browser or app may not be secure". The fix is not to make
// automation look less automated; it is to stop signing in inside automation
// at all. You sign in here, normally, in real Chrome. The worker then joins
// the browser you are already signed in to.
//
// WHY THIS IS A SEPARATE WINDOW, AND NOT YOUR EVERYDAY CHROME
//
// Two things make attaching to your existing browser impossible, not merely
// unimplemented:
//
//   1. A running Chrome cannot be attached to after the fact. The DevTools
//      port only exists if Chrome was started with --remote-debugging-port,
//      and there is no way to switch it on later.
//   2. Chrome 136 (2025) refuses --remote-debugging-port entirely when it is
//      pointed at the default profile directory, as a fix for malware stealing
//      cookies through DevTools. A separate --user-data-dir is required.
//
// So this window is its own Chrome profile. What it is not is a throwaway: it
// persists, so you sign in once, and it opens the dashboard alongside the sites
// the run needs — which means you can work entirely in this one window rather
// than keeping two browsers side by side.
//
// Usage:
//   npm run chrome                        # then start the worker in another terminal
//   npm run chrome -- --port=9222
//   npm run chrome -- --dashboard=http://localhost:3000
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

/** One quick probe. Returns the browser version string, or null if nothing is listening. */
async function probeDevTools(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) return null;
    const info = (await response.json()) as { Browser?: string };
    return info.Browser ?? "Chrome";
  } catch {
    return null;
  }
}

async function waitForDevTools(port: number, exited: { code: number | null }): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const version = await probeDevTools(port);
    if (version) return version;
    // Chrome hands a second launch off to the instance that is already running
    // and then exits immediately. When that happens the port never opens, and
    // waiting the full timeout would say nothing useful about why.
    if (exited.code !== null) {
      throw new Error(
        `Chrome exited straight away without opening the DevTools port.\n\n` +
          `That normally means Chrome was already running with this profile directory, so this\n` +
          `launch just opened a tab in the existing window and quit.\n\n` +
          `Close Chrome completely and run this again. On Windows, check the system tray and Task\n` +
          `Manager for leftover chrome.exe processes — Chrome often keeps running in the background\n` +
          `after the last window closes.`
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Chrome's DevTools endpoint never came up on port ${port}.`);
}

async function main() {
  const port = Number(getArg("port") ?? process.env.CHROME_DEBUG_PORT ?? 9222);
  const cdpUrl = `http://127.0.0.1:${port}`;
  const dashboard = getArg("dashboard") ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  // Re-running this must not spawn a second Chrome on top of the first.
  const already = await probeDevTools(port);
  if (already) {
    console.log("");
    console.log(`${already} is already running with a DevTools port on ${port}.`);
    console.log("Use that one — no need to start another. Point the worker at:");
    console.log("");
    console.log(`  BROWSER_CDP_URL=${cdpUrl}`);
    console.log("");
    return;
  }

  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error(
      "Google Chrome was not found. Install it, or point CHROME_PATH at the executable."
    );
  }

  // A dedicated user-data directory, and not a choice: Chrome 136+ refuses
  // --remote-debugging-port on the default profile. It persists, so signing in
  // is a one-time cost rather than a per-run one.
  const userDataDir = path.join(os.homedir(), ".automation-os", "chrome-session");
  fs.mkdirSync(userDataDir, { recursive: true });

  const chrome = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      // The dashboard rides along so this is the only browser you need open.
      dashboard,
      "https://chatgpt.com/",
      "https://labs.google/fx/tools/flow",
    ],
    { stdio: "ignore" }
  );

  const exited: { code: number | null } = { code: null };
  chrome.on("error", (err) => console.error("Chrome failed to start:", err.message));
  chrome.on("exit", (code) => {
    exited.code = code ?? 0;
  });

  const version = await waitForDevTools(port, exited);

  // Only now is it safe to treat a later exit as "the person closed Chrome".
  chrome.on("exit", (code) => {
    console.log(`\nChrome closed (code ${code}). The worker can no longer attach.`);
    process.exit(code ?? 0);
  });

  console.log("");
  console.log("==========================================================");
  console.log(`  ${version} is running with a DevTools port.`);
  console.log(`  Profile directory: ${userDataDir}`);
  console.log("");
  console.log("  This is a separate Chrome window on purpose. Chrome refuses a");
  console.log("  DevTools port on your everyday profile, and a browser that is");
  console.log("  already running cannot be attached to afterwards. So work in");
  console.log("  THIS window — the dashboard is open in it already.");
  console.log("");
  console.log("  1. Sign in to ChatGPT and to Google Flow in this window.");
  console.log("     Normal Google sign-in works here: it is a real browser.");
  console.log("     You only have to do this once — the profile persists.");
  console.log("");
  console.log("  2. Leave this window open, and leave this terminal running.");
  console.log("");
  console.log("  3. In another terminal, start the worker with:");
  console.log("");
  console.log(`       BROWSER_CDP_URL=${cdpUrl} npm run worker`);
  console.log("");
  console.log(`     Windows PowerShell:  $env:BROWSER_CDP_URL="${cdpUrl}"; npm run worker`);
  console.log("     Or add this line to .env:");
  console.log(`       BROWSER_CDP_URL=${cdpUrl}`);
  console.log("");
  console.log(`  Tabs open: ${dashboard} | chatgpt.com | labs.google Flow`);
  console.log("  Press Ctrl+C here when you are done to close this Chrome.");
  console.log("==========================================================");
  console.log("");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

// Opens a real, visible (headed) Chromium window so you can log into a
// website by hand — solving CAPTCHAs/MFA yourself, exactly as the platform
// requires — then saves the resulting session (cookies + localStorage) onto
// a BrowserProfile, encrypted at rest, for automations to reuse.
//
// Usage: npm run login-helper -- --profile=<browserProfileId> [--url=https://example.com/login]
import "dotenv/config";
import { chromium } from "playwright";
import { connectToDatabase, disconnectDatabase, BrowserProfile } from "@bos/database";
import { encryptJSON, decryptJSON } from "@bos/security";

function getArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=")[1];
}

async function main() {
  const profileId = getArg("profile");
  const startUrl = getArg("url") ?? "about:blank";
  if (!profileId) {
    console.error("Usage: npm run login-helper -- --profile=<browserProfileId> [--url=https://example.com/login]");
    process.exit(1);
  }

  await connectToDatabase();
  const profile = await BrowserProfile.findById(profileId).select("+encryptedStorageState");
  if (!profile) {
    console.error(`Browser profile ${profileId} not found. Create it from the dashboard first.`);
    process.exit(1);
  }

  const existingState = profile.encryptedStorageState ? decryptJSON(profile.encryptedStorageState) : undefined;

  console.log(`Opening a browser window for profile "${profile.name}"...`);
  console.log("Log in manually (including any MFA/CAPTCHA), then simply CLOSE the browser window when done.");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: profile.userAgent,
    viewport: profile.viewport,
    locale: profile.locale,
    timezoneId: profile.timezone,
    storageState: existingState as never,
  });
  const page = await context.newPage();
  await page.goto(startUrl);

  await new Promise<void>((resolve) => {
    context.on("close", () => resolve());
    browser.on("disconnected", () => resolve());
  });

  // The context may already be closed by the user closing the window; guard
  // against calling storageState() on a dead context.
  try {
    const state = await context.storageState();
    profile.encryptedStorageState = encryptJSON(state);
    profile.status = "ready";
    profile.lastUsedAt = new Date();
    await profile.save();
    console.log(`Saved session for profile "${profile.name}". Automations using this profile will now start already logged in.`);
  } catch (err) {
    console.error("Could not read the session before the window closed:", err);
  }

  await disconnectDatabase();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

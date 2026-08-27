// Opens a real, visible Chromium window so you can log into websites by hand,
// then saves the resulting session (cookies + localStorage) onto a BrowserProfile.
//
// Usage: npm run login-helper -- --profile=<browserProfileId> [--url=https://example.com/login]
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
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
  console.log("Log in to the required sites in this same browser window.");
  console.log("When finished, return to this terminal and press Enter. Do NOT close the browser first.");

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

  const rl = readline.createInterface({ input, output });
  await rl.question("Press Enter here after ChatGPT and Google Flow are both logged in... ");
  rl.close();

  const state = await context.storageState();
  profile.encryptedStorageState = encryptJSON(state);
  profile.status = "ready";
  profile.lastUsedAt = new Date();
  await profile.save();
  console.log(`Saved session for profile "${profile.name}". Status is now ready.`);

  await browser.close();
  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDatabase();
  } catch {}
  process.exit(1);
});

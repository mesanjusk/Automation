import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface ProfileOptions {
  userAgent?: string;
  viewport?: { width: number; height: number };
  locale?: string;
  timezone?: string;
  storageState?: unknown; // decrypted Playwright storageState JSON, or undefined for a fresh profile
}

let sharedBrowser: Browser | null = null;

async function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
    });
  }
  return sharedBrowser;
}

export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

/**
 * A BrowserSession wraps one BrowserContext (== one browser profile in use)
 * and tracks every open tab so workflow nodes like NEW_TAB / SWITCH_TAB /
 * CLOSE_TAB have something concrete to act on.
 */
export class BrowserSession {
  context: BrowserContext;
  tabs: Page[] = [];
  activeTabIndex = 0;

  private constructor(context: BrowserContext, initialPage: Page) {
    this.context = context;
    this.tabs = [initialPage];
    context.on("page", (page) => {
      if (!this.tabs.includes(page)) this.tabs.push(page);
    });
  }

  static async launch(profile: ProfileOptions): Promise<BrowserSession> {
    const browser = await getSharedBrowser();
    const context = await browser.newContext({
      userAgent: profile.userAgent,
      viewport: profile.viewport ?? { width: 1440, height: 900 },
      locale: profile.locale ?? "en-US",
      timezoneId: profile.timezone ?? "UTC",
      storageState: profile.storageState as never,
      acceptDownloads: true,
    });
    context.setDefaultTimeout(30_000);
    const page = await context.newPage();
    return new BrowserSession(context, page);
  }

  get activePage(): Page {
    const page = this.tabs[this.activeTabIndex];
    if (!page) throw new Error("No active browser tab");
    return page;
  }

  async newTab(url?: string): Promise<Page> {
    const page = await this.context.newPage();
    if (!this.tabs.includes(page)) this.tabs.push(page);
    this.activeTabIndex = this.tabs.indexOf(page);
    if (url) await page.goto(url, { waitUntil: "domcontentloaded" });
    return page;
  }

  switchTab(index: number): Page {
    if (index < 0 || index >= this.tabs.length) {
      throw new Error(`Tab index ${index} out of range (have ${this.tabs.length} tabs)`);
    }
    this.activeTabIndex = index;
    return this.activePage;
  }

  async closeTab(index?: number): Promise<void> {
    const i = index ?? this.activeTabIndex;
    const page = this.tabs[i];
    if (!page) return;
    await page.close();
    this.tabs.splice(i, 1);
    if (this.tabs.length === 0) {
      await this.newTab();
    } else {
      this.activeTabIndex = Math.min(this.activeTabIndex, this.tabs.length - 1);
    }
  }

  /** Exportable, encryptable storage state (cookies + localStorage) for profile persistence. */
  async exportStorageState(): Promise<unknown> {
    return this.context.storageState();
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}

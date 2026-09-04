import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface ProfileOptions {
  userAgent?: string;
  viewport?: { width: number; height: number };
  locale?: string;
  timezone?: string;
  storageState?: unknown; // decrypted Playwright storageState JSON, or undefined for a fresh profile
}

let sharedBrowser: Browser | null = null;

/** Whether Chromium runs without a visible window. Set PLAYWRIGHT_HEADLESS=false to watch, or to log in by hand. */
export function isHeadless(): boolean {
  return process.env.PLAYWRIGHT_HEADLESS !== "false";
}

async function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({ headless: isHeadless() });
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
  /**
   * Recorded at launch. Anything that asks a person to act in the browser —
   * signing in by hand, solving a challenge — has to know there is a window
   * for them to act in, and say so plainly when there is not.
   */
  readonly headless: boolean;

  private constructor(context: BrowserContext, initialPage: Page, headless: boolean) {
    this.context = context;
    this.headless = headless;
    this.tabs = [];
    this.track(initialPage);
    context.on("page", (page) => this.track(page));
  }

  /**
   * Tracks a tab and forgets it the moment it closes.
   *
   * A tab can go away without anyone calling closeTab(): the site closes its
   * own popup, or Chrome kills a crashed renderer. Left in `tabs`, that dead
   * Page stays reachable through activePage and switchTab, and every later
   * action against it fails with "Target page, context or browser has been
   * closed" instead of falling through to a tab that is still alive.
   */
  private track(page: Page): void {
    if (this.tabs.includes(page)) return;
    this.tabs.push(page);
    page.once("close", () => this.forget(page));
  }

  /** Idempotent: the close event and closeTab() both land here. */
  private forget(page: Page): void {
    const index = this.tabs.indexOf(page);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    if (this.activeTabIndex > index) this.activeTabIndex -= 1;
    if (this.activeTabIndex >= this.tabs.length) this.activeTabIndex = Math.max(0, this.tabs.length - 1);
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
    return new BrowserSession(context, page, isHeadless());
  }

  get activePage(): Page {
    // Playwright delivers 'close' asynchronously, so a tab can already be dead
    // by the time someone asks for it. Drop those now rather than handing back
    // a Page whose every method throws.
    for (const dead of this.tabs.filter((page) => page.isClosed())) this.forget(dead);
    const page = this.tabs[this.activeTabIndex];
    if (!page) throw new Error("No active browser tab");
    return page;
  }

  async newTab(url?: string): Promise<Page> {
    const page = await this.context.newPage();
    this.track(page);
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
    this.forget(page);
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

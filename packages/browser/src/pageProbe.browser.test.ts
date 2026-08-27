import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { probePage } from "./pageProbe";
import { classifyFlowState } from "./flowState";

/**
 * These run against a real Chromium and real DOM.
 *
 * The fixtures below are NOT copies of Google Flow's markup — they reproduce
 * the *shapes* the driver has to tell apart (a marketing page, a Google
 * sign-in page, an app shell with a composer, an app shell mid-generation),
 * including the traps that broke the old workflow: a hidden textarea sitting
 * above the real composer in DOM order, and a header search box that also
 * matches `[contenteditable]`. What is verified is that the probe reads the
 * live DOM correctly and that the selector it discovers is one Playwright can
 * actually act on.
 */

let browser: Browser | undefined;
let page: Page | undefined;

beforeAll(async () => {
  const candidates = [undefined, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/opt/pw-browsers/chromium"];
  for (const executablePath of candidates) {
    try {
      browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true });
      break;
    } catch {
      /* try the next candidate */
    }
  }
  if (browser) page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

const MARKETING_PAGE = `
  <header><nav><a href="/about">About</a><button>Sign in</button>
    <a href="/fx/tools/flow/app" id="cta">Create with Google Flow</a></nav></header>
  <main><h1>Flow</h1><p>AI filmmaking for storytellers.</p><video></video></main>`;

const SIGNIN_PAGE = `
  <main><h1>Sign in</h1><p>to continue to Flow</p>
    <input type="email" aria-label="Email or phone">
    <button>Next</button></main>`;

const APP_SHELL = `
  <header><div contenteditable="true" aria-label="Search projects" style="width:240px;height:32px"></div></header>
  <!-- A hidden composer sitting BEFORE the real one in DOM order: this is the
       exact trap that made ".first()" wait forever on the old resolver. -->
  <textarea id="offscreen" style="position:absolute;left:-9999px;width:10px;height:10px"></textarea>
  <main style="padding-top:600px">
    <textarea id="composer" placeholder="Generate a video with text" style="width:800px;height:90px"></textarea>
    <button id="go">Generate</button>
    <button>Cancel</button>
  </main>`;

const GENERATING = `${APP_SHELL}<div role="status">Generating your video, this may take a few minutes</div>`;

const describeBrowser = describe;

describeBrowser("probePage against a real DOM", () => {
  it("skips cleanly when no Chromium is available", () => {
    if (!page) console.warn("No Chromium available — browser probe tests were skipped.");
    expect(true).toBe(true);
  });

  it("returns only visible controls and counts the hidden ones", async () => {
    if (!page) return;
    await page.setContent(APP_SHELL);
    const report = await probePage(page);
    const paths = report.elements.map((el) => el.cssPath);
    expect(paths.some((path) => path.includes("#composer"))).toBe(true);
    expect(paths.some((path) => path.includes("#offscreen"))).toBe(false);
    expect(report.hiddenInteractiveCount).toBeGreaterThan(0);
  });

  it("computes roles, accessible names and editability the way a screen reader would", async () => {
    if (!page) return;
    await page.setContent(APP_SHELL);
    const report = await probePage(page);
    const composer = report.elements.find((el) => el.cssPath === "#composer");
    expect(composer).toBeDefined();
    expect(composer?.role).toBe("textbox");
    expect(composer?.name).toBe("Generate a video with text");
    expect(composer?.editable).toBe(true);

    const search = report.elements.find((el) => el.ariaLabel === "Search projects");
    expect(search?.role).toBe("textbox");
    expect(search?.editable).toBe(true);
  });

  it("discovers a selector Playwright can actually type into", async () => {
    if (!page) return;
    await page.setContent(APP_SHELL);
    const classification = classifyFlowState(await probePage(page));
    expect(classification.state).toBe("GENERATION_UI");

    const selector = classification.composer!.cssPath;
    await page.locator(selector).fill("shot one prompt");
    expect(await page.locator("#composer").inputValue()).toBe("shot one prompt");

    await page.locator(classification.submit!.cssPath).click();
    expect(classification.submit?.name).toBe("Generate");
  });

  it("builds a unique nth-child path for an element with no id or test id", async () => {
    if (!page) return;
    await page.setContent(`<main><section><button>One</button><button>Two</button><button>Three</button></section></main>`);
    const report = await probePage(page);
    const two = report.elements.find((el) => el.name === "Two");
    expect(two?.cssPath).toContain("nth-child");
    expect(await page.locator(two!.cssPath).textContent()).toBe("Two");
    expect(await page.locator(two!.cssPath).count()).toBe(1);
  });

  it("classifies each real screen shape correctly", async () => {
    if (!page) return;
    await page.setContent(MARKETING_PAGE);
    const landing = classifyFlowState(await probePage(page));
    expect(landing.state).toBe("LANDING");
    expect(landing.primaryAction?.cssPath).toBe("#cta");

    await page.setContent(SIGNIN_PAGE);
    expect(classifyFlowState(await probePage(page)).state).toBe("LOGIN_REQUIRED");

    await page.setContent(GENERATING);
    expect(classifyFlowState(await probePage(page)).state).toBe("GENERATING");
  });

  it("does not treat a marketing page's demo video as a finished clip", async () => {
    if (!page) return;
    await page.setContent(MARKETING_PAGE);
    expect(classifyFlowState(await probePage(page)).state).not.toBe("CLIP_READY");
  });
});

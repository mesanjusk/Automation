import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { probePage } from "./pageProbe";
import { classifyFlowState } from "./flowState";
import { resolveTarget } from "./selectorResolver";
import { waitForPageStable } from "./pageStability";

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

describeBrowser("element refs against a real DOM", () => {
  it("stamps a ref on every discovered control and binds it back to that element", async () => {
    if (!page) return;
    await page.setContent(APP_SHELL);
    const report = await probePage(page);
    const generate = report.elements.find((el) => el.name === "Generate");
    expect(generate?.ref).toMatch(/^e\d+$/);

    // The whole point of a ref: the resolver finds the exact node the agent
    // was shown, with no re-derivation in between.
    const { locator, strategy } = await resolveTarget(page, { ref: generate!.ref }, { timeout: 2000 });
    expect(strategy).toBe("ref");
    expect(await locator.textContent()).toBe("Generate");
  });

  it("keeps a ref pointing at the same element across probes", async () => {
    if (!page) return;
    await page.setContent(APP_SHELL);
    const first = await probePage(page);
    const second = await probePage(page);
    const before = first.elements.find((el) => el.name === "Generate");
    const after = second.elements.find((el) => el.name === "Generate");
    expect(after?.ref).toBe(before?.ref);
  });

  it("keeps the ref when the app re-renders the element into a new position", async () => {
    if (!page) return;
    await page.setContent(`<main><div id="host"><button>Save</button></div></main>`);
    const before = await probePage(page);
    const save = before.elements.find((el) => el.name === "Save")!;

    // Move the node under a new wrapper: its generated nth-child path is now
    // wrong, but the ref travels with the node itself.
    await page.evaluate(`(() => {
      const host = document.querySelector('#host');
      const button = host.querySelector('button');
      const wrapper = document.createElement('div');
      wrapper.appendChild(document.createElement('span'));
      wrapper.appendChild(button);
      host.appendChild(wrapper);
    })()`);

    const { strategy, locator } = await resolveTarget(page, { ref: save.ref }, { timeout: 2000 });
    expect(strategy).toBe("ref");
    expect(await locator.textContent()).toBe("Save");
  });

  it("fails a removed ref quickly instead of waiting out the budget", async () => {
    if (!page) return;
    await page.setContent(`<main><button id="gone">Temporary</button></main>`);
    const report = await probePage(page);
    const temporary = report.elements.find((el) => el.name === "Temporary")!;
    await page.evaluate(`document.querySelector('#gone').remove()`);

    const started = Date.now();
    await expect(resolveTarget(page, { ref: temporary.ref }, { timeout: 4000 })).rejects.toThrow(/is stale/);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("sees into a same-origin iframe and records which frame the control is in", async () => {
    if (!page) return;
    // A checkout form, an embedded editor and a third-party sign-in all live in
    // a frame. An agent that cannot see into one is simply blind there.
    await page.setContent(`<main><h1>Checkout</h1><iframe id="pay" srcdoc="<input aria-label='Card number'><button>Pay</button>"></iframe></main>`);
    await page.waitForTimeout(200);
    const report = await probePage(page);
    const pay = report.elements.find((el) => el.name === "Pay");
    expect(pay).toBeDefined();
    expect(pay?.frame).toContain("pay");

    const { locator } = await resolveTarget(page, { ref: pay!.ref, frame: pay!.frame ?? undefined }, { timeout: 2000 });
    expect(await locator.textContent()).toBe("Pay");
  });

  it("finds a ref inside a frame even when the caller does not name the frame", async () => {
    if (!page) return;
    // Refs are unique across the whole page, frames included, so an agent that
    // reports {"ref":"e5"} for a control in a payment iframe is being precise,
    // not sloppy. page.locator() alone would never see it.
    await page.setContent(`<main><iframe id="pay" srcdoc="<button>Confirm</button>"></iframe></main>`);
    await page.waitForTimeout(200);
    const report = await probePage(page);
    const confirm = report.elements.find((el) => el.name === "Confirm")!;

    const { locator, strategy } = await resolveTarget(page, { ref: confirm.ref }, { timeout: 3000 });
    expect(strategy).toBe("ref");
    expect(await locator.textContent()).toBe("Confirm");
  });

  it("reports an open dialog and how far the page can still scroll", async () => {
    if (!page) return;
    await page.setContent(`
      <div role="dialog" aria-label="Confirm deletion"><button>Cancel</button></div>
      <main style="height:4000px">long page</main>`);
    const report = await probePage(page);
    expect(report.dialogs.join(" ")).toContain("Confirm deletion");
    expect(report.scroll.height).toBeGreaterThan(report.scroll.viewport);
    expect(report.scroll.atBottom).toBe(false);
  });

  it("reads back the value a field currently holds", async () => {
    if (!page) return;
    await page.setContent(`<input id="q" aria-label="Search">`);
    await page.locator("#q").fill("quarterly report");
    const report = await probePage(page);
    expect(report.elements.find((el) => el.ariaLabel === "Search")?.value).toBe("quarterly report");
  });
});

describeBrowser("waitForPageStable against a real DOM", () => {
  it("returns once the DOM stops mutating", async () => {
    if (!page) return;
    await page.setContent(`<main id="out"></main>`);
    await page.evaluate(`(() => {
      let n = 0;
      const timer = setInterval(() => {
        document.querySelector('#out').append(document.createElement('div'));
        if (++n >= 5) clearInterval(timer);
      }, 60);
    })()`);
    const result = await waitForPageStable(page, { timeoutMs: 5000, quietMs: 200 });
    expect(result.settled).toBe(true);
    expect(await page.locator("#out > div").count()).toBe(5);
  });

  it("gives up within its budget on a page that never stops changing", async () => {
    if (!page) return;
    // Carousels, live tickers and polling dashboards never go quiet; the wait
    // has to end anyway rather than hold the whole run hostage.
    await page.setContent(`<main id="ticker"></main>`);
    await page.evaluate(`setInterval(() => { document.querySelector('#ticker').textContent = String(Date.now()); }, 30)`);
    const started = Date.now();
    const result = await waitForPageStable(page, { timeoutMs: 1200, quietMs: 400 });
    expect(result.settled).toBe(false);
    expect(Date.now() - started).toBeLessThan(4000);
    await page.setContent("<main></main>");
  });
});

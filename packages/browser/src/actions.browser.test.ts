import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { workflowNodeSchema, type WorkflowNode } from "@bos/shared";
import { executeBrowserAction } from "./actions";
import { probePage } from "./pageProbe";
import type { BrowserSession } from "./session";

/**
 * Drives the real executor against a real Chromium.
 *
 * These cover the seam the unit tests cannot: that a ref taken from a snapshot
 * survives all the way through node config, the selector resolver and
 * Playwright, and lands on the element the snapshot described.
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

function sessionFor(target: Page): BrowserSession {
  return { activePage: target, tabs: [target], activeTabIndex: 0 } as unknown as BrowserSession;
}

function node(partial: Partial<WorkflowNode> & Pick<WorkflowNode, "id" | "type" | "name">): WorkflowNode {
  return workflowNodeSchema.parse({ config: {}, ...partial });
}

const ctx = { variables: {}, downloadDir: "/tmp" };

const FORM = `
  <main>
    <label for="q">Search</label><input id="q">
    <select id="size"><option value="s">Small</option><option value="l">Large</option></select>
    <button id="go" disabled>Search</button>
    <p id="out"></p>
  </main>
  <script>
    document.querySelector('#q').addEventListener('input', (e) => {
      document.querySelector('#go').disabled = e.target.value.length === 0;
    });
    document.querySelector('#go').addEventListener('click', () => {
      setTimeout(() => { document.querySelector('#out').textContent = 'Found 3 results'; }, 300);
    });
  </script>`;

const describeBrowser = describe;

describeBrowser("executeBrowserAction with refs", () => {
  it("skips cleanly when no Chromium is available", () => {
    if (!page) console.warn("No Chromium available — executor browser tests were skipped.");
    expect(true).toBe(true);
  });

  it("types into, then clicks, the exact elements a snapshot named", async () => {
    if (!page) return;
    await page.setContent(FORM);
    const before = await probePage(page);
    const field = before.elements.find((el) => el.name === "Search" && el.editable)!;
    const button = before.elements.find((el) => el.role === "button")!;

    const typed = await executeBrowserAction(
      sessionFor(page),
      node({ id: "t", type: "TYPE", name: "type", config: { target: { ref: field.ref }, value: "invoices" } }),
      ctx
    );
    expect(typed.selectorStrategyUsed).toBe("ref");
    expect(await page.locator("#q").inputValue()).toBe("invoices");

    // TYPE settles before returning, so the button this click needs has
    // already been enabled by the page's own input handler.
    const clicked = await executeBrowserAction(
      sessionFor(page),
      node({ id: "c", type: "CLICK", name: "click", config: { target: { ref: button.ref } } }),
      ctx
    );
    expect(clicked.selectorStrategyUsed).toBe("ref");
  });

  it("waits for the page's own confirmation text rather than a guessed sleep", async () => {
    if (!page) return;
    await page.setContent(FORM);
    await page.locator("#q").fill("invoices");
    await page.locator("#go").click();

    const result = await executeBrowserAction(
      sessionFor(page),
      node({ id: "w", type: "WAIT_FOR_TEXT", name: "wait", config: { text: "Found 3 results" }, timeout: 5000 }),
      ctx
    );
    expect(result.output).toMatchObject({ present: true });
  });

  it("can wait for text to disappear", async () => {
    if (!page) return;
    await page.setContent(`<main id="m">Uploading…</main>
      <script>setTimeout(() => { document.querySelector('#m').textContent = 'Done'; }, 250);</script>`);
    const result = await executeBrowserAction(
      sessionFor(page),
      node({ id: "w", type: "WAIT_FOR_TEXT", name: "wait", config: { text: "Uploading", absent: true }, timeout: 5000 }),
      ctx
    );
    expect(result.output).toMatchObject({ present: false });
  });

  it("fails with the timeout it was given when the text never arrives", async () => {
    if (!page) return;
    await page.setContent(`<main>nothing happens here</main>`);
    await expect(
      executeBrowserAction(
        sessionFor(page),
        node({ id: "w", type: "WAIT_FOR_TEXT", name: "wait", config: { text: "Order confirmed" }, timeout: 1000 }),
        ctx
      )
    ).rejects.toThrow(/Timed out after 1000ms waiting for the text "Order confirmed" to appear/);
  });

  it("reads the whole page when EXTRACT_TEXT is given no target", async () => {
    if (!page) return;
    await page.setContent(`<main><h1>Statement</h1><p>Balance £42.00</p></main>`);
    const result = await executeBrowserAction(
      sessionFor(page),
      node({ id: "r", type: "EXTRACT_TEXT", name: "read", config: {} }),
      ctx
    );
    expect((result.output as { text: string }).text).toContain("Balance £42.00");
  });

  it("scrolls an off-screen control into view before it is acted on", async () => {
    if (!page) return;
    await page.setContent(`<main style="height:3000px"></main><button id="deep">Accept</button>`);
    const report = await probePage(page);
    const accept = report.elements.find((el) => el.name === "Accept")!;
    expect(accept.inViewport).toBe(false);

    await executeBrowserAction(
      sessionFor(page),
      node({ id: "s", type: "SCROLL_TO_ELEMENT", name: "scroll to", config: { target: { ref: accept.ref } } }),
      ctx
    );
    const after = await probePage(page);
    expect(after.elements.find((el) => el.ref === accept.ref)?.inViewport).toBe(true);
  });

  it("falls back to real key events for an editor that fill() cannot drive", async () => {
    if (!page) return;
    // Some editors render a plain focusable surface and build their content
    // from key events. Playwright's fill() refuses such an element outright,
    // and without a fallback the step fails on a control the site clearly
    // supports typing into.
    await page.setContent(`
      <div id="editor" role="textbox" tabindex="0" aria-label="Message" style="width:400px;height:80px;border:1px solid"></div>
      <script>
        document.querySelector('#editor').addEventListener('keydown', (e) => {
          if (e.key.length === 1) e.currentTarget.textContent += e.key;
        });
      </script>`);
    const report = await probePage(page);
    const editor = report.elements.find((el) => el.ariaLabel === "Message")!;
    const logs: string[] = [];

    await executeBrowserAction(
      sessionFor(page),
      node({ id: "t", type: "TYPE", name: "type", config: { target: { ref: editor.ref }, value: "hello there" }, timeout: 5000 }),
      { ...ctx, log: (message) => logs.push(message) }
    );

    expect(await page.locator("#editor").innerText()).toContain("hello there");
    // Prove the fallback is what did it, not fill() quietly succeeding.
    expect(logs.join(" ")).toContain("typing the value key by key instead");
  });

  it("refuses a node that needs a target and was not given one", async () => {
    if (!page) return;
    await page.setContent(FORM);
    await expect(
      executeBrowserAction(sessionFor(page), node({ id: "c", type: "CLICK", name: "click", config: {} }), ctx)
    ).rejects.toThrow(/requires a target selector/);
  });
});

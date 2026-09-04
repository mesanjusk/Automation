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
  return { activePage: target, tabs: [target], activeTabIndex: 0, headless: false } as unknown as BrowserSession;
}

/** A session backed by the real browser context, so tabs really open and persist. */
function liveSession(first: Page, headless = false): BrowserSession {
  const tabs: Page[] = [first];
  const session = {
    tabs,
    activeTabIndex: 0,
    headless,
    get activePage() {
      return tabs[session.activeTabIndex]!;
    },
    switchTab(index: number) {
      session.activeTabIndex = index;
      return tabs[index]!;
    },
    async newTab(url?: string) {
      const page = await first.context().newPage();
      tabs.push(page);
      session.activeTabIndex = tabs.length - 1;
      if (url) await page.goto(url, { waitUntil: "domcontentloaded" });
      return page;
    },
  };
  return session as unknown as BrowserSession;
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

describeBrowser("WAIT_FOR_LOGIN", () => {
  it("opens each site, waits for the person, and leaves the tabs open", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const first = await context.newPage();
    // Data URLs stand in for the real sign-in pages: what is being tested is
    // that the run opens the tabs, hands control to a person, and continues in
    // the same session — not anything about Google or ChatGPT specifically.
    const signedIn = `data:text/html,<title>Inbox</title><h1>Signed in</h1>`;
    const alsoSignedIn = `data:text/html,<title>Studio</title><h1>Ready</h1>`;
    const prompts: string[] = [];
    const session = liveSession(first);

    const result = await executeBrowserAction(
      session,
      node({
        id: "gate",
        type: "WAIT_FOR_LOGIN",
        name: "sign in",
        config: { urls: [signedIn, alsoSignedIn], message: "Sign in to both.", screenshot: false },
      }),
      { ...ctx, confirmWithHuman: async (prompt) => { prompts.push(prompt); } }
    );

    // Both tabs are still open and usable afterwards — the whole point.
    expect(session.tabs).toHaveLength(2);
    expect(await session.tabs[0]!.title()).toBe("Inbox");
    expect(await session.tabs[1]!.title()).toBe("Studio");
    // And it hands back to the first tab so the next step starts where it expects.
    expect(session.activeTabIndex).toBe(0);
    expect((result.output as { signedOutTabs: string[] }).signedOutTabs).toEqual([]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Sign in to both.");
    await context.close();
  });

  it("reuses the tab the run started in rather than stranding a blank one", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const first = await context.newPage();
    const session = liveSession(first);

    await executeBrowserAction(
      session,
      node({ id: "gate", type: "WAIT_FOR_LOGIN", name: "sign in", config: { urls: [`data:text/html,<title>Only</title>`], screenshot: false } }),
      { ...ctx, confirmWithHuman: async () => undefined }
    );

    expect(session.tabs).toHaveLength(1);
    expect(await session.tabs[0]!.title()).toBe("Only");
    await context.close();
  });

  it("asks a second time when a tab still looks signed out, then continues", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const first = await context.newPage();
    const session = liveSession(first);
    const prompts: string[] = [];

    const result = await executeBrowserAction(
      session,
      node({
        id: "gate",
        type: "WAIT_FOR_LOGIN",
        name: "sign in",
        config: { urls: [`data:text/html,<title>Sign in to continue</title>`], screenshot: false },
      }),
      { ...ctx, confirmWithHuman: async (prompt) => { prompts.push(prompt); } }
    );

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("still look signed out");
    // It warns, it does not block: the person at the keyboard decides.
    expect((result.output as { signedOutTabs: string[] }).signedOutTabs).toHaveLength(1);
    await context.close();
  });

  it("refuses to ask for a sign-in that nobody could perform", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const first = await context.newPage();

    await expect(
      executeBrowserAction(
        liveSession(first, true),
        node({ id: "gate", type: "WAIT_FOR_LOGIN", name: "sign in", config: { urls: ["data:text/html,x"] } }),
        { ...ctx, confirmWithHuman: async () => undefined }
      )
    ).rejects.toThrow(/PLAYWRIGHT_HEADLESS=false/);
    await context.close();
  });

  it("says what to do when there is no terminal to ask at", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const first = await context.newPage();

    await expect(
      executeBrowserAction(
        liveSession(first),
        node({ id: "gate", type: "WAIT_FOR_LOGIN", name: "sign in", config: { urls: ["data:text/html,x"] } }),
        ctx
      )
    ).rejects.toThrow(/npm run worker/);
    await context.close();
  });
});

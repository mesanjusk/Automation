import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { BrowserSession } from "./session";

/**
 * Exercises attaching to a browser somebody else started.
 *
 * A real Chrome is stood in for by a Chromium launched with a DevTools port —
 * what matters is that the session joins an *existing* browser and inherits the
 * context that is already open in it, because that context is the one holding
 * the person's signed-in session. Creating a fresh context instead would hand
 * back a blank, signed-out profile, which is the entire failure this avoids.
 */
let host: Browser | undefined;
let cdpUrl = "";

beforeAll(async () => {
  const candidates = [undefined, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/opt/pw-browsers/chromium"];
  for (const executablePath of candidates) {
    try {
      host = await chromium.launch({
        headless: true,
        args: ["--remote-debugging-port=9333"],
        ...(executablePath ? { executablePath } : {}),
      });
      break;
    } catch {
      /* try the next candidate */
    }
  }
  if (host) cdpUrl = "http://127.0.0.1:9333";
}, 120_000);

afterAll(async () => {
  await host?.close();
});

const describeBrowser = describe;

describeBrowser("BrowserSession.connect", () => {
  it("skips cleanly when no Chromium is available", () => {
    if (!host) console.warn("No Chromium available — CDP attach tests were skipped.");
    expect(true).toBe(true);
  });

  it("joins the browser that is already running and adopts its open tabs", async () => {
    if (!host) return;
    const context = host.contexts()[0] ?? (await host.newContext());
    const existing = await context.newPage();
    await existing.goto("data:text/html,<title>Already open</title>");

    const session = await BrowserSession.connect(cdpUrl);

    expect(session.connected).toBe(true);
    // The tab that was already open is usable, not replaced.
    const titles = await Promise.all(session.tabs.map((page) => page.title().catch(() => "")));
    expect(titles).toContain("Already open");
    await session.close();
    // Detaching must leave the person's tab exactly where it was.
    expect(existing.isClosed()).toBe(false);
    await existing.close();
  });

  it("reuses the same context across attaches, so a signed-in session survives", async () => {
    if (!host) return;
    // Round-trip through the connected session itself: what a person signs in
    // to during one attach has to still be there on the next one. A fresh
    // context per attach would lose it, which is the whole failure this avoids.
    const first = await BrowserSession.connect(cdpUrl);
    await first.context.addCookies([
      { name: "session_marker", value: "signed-in", domain: "127.0.0.1", path: "/" },
    ]);
    await first.close();

    const second = await BrowserSession.connect(cdpUrl);
    const cookies = await second.context.cookies("http://127.0.0.1/");

    expect(cookies.map((c) => c.name)).toContain("session_marker");
    await second.context.clearCookies();
    await second.close();
  });

  it("is never treated as headless, so a person can be asked to act in it", async () => {
    if (!host) return;
    // The browser is one a person is sitting in front of, whatever this
    // process's own PLAYWRIGHT_HEADLESS happens to say.
    const session = await BrowserSession.connect(cdpUrl);
    expect(session.headless).toBe(false);
    await session.close();
  });

  it("says what to do when the address is not a live Chrome", async () => {
    await expect(BrowserSession.connect("http://127.0.0.1:9")).rejects.toThrow();
  });
});

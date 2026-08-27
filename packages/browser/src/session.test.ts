import { describe, expect, it } from "vitest";
import type { BrowserContext, Page } from "playwright";
import { BrowserSession } from "./session";

/** A Page that can be closed, and tells its listeners when it is. */
function fakePage(): Page & { fire(): void } {
  let closed = false;
  const listeners: Array<() => void> = [];
  return {
    isClosed: () => closed,
    once: (event: string, handler: () => void) => {
      if (event === "close") listeners.push(handler);
    },
    close: async () => {
      closed = true;
      for (const handler of listeners.splice(0)) handler();
    },
    /** Closes without notifying — how a crashed renderer behaves. */
    fire: () => {
      closed = true;
    },
  } as unknown as Page & { fire(): void };
}

/**
 * `private constructor` is a compile-time marker only, so the tests build a
 * session over fake tabs rather than launching a real Chromium.
 */
function fakeSession(initial: Page): { session: BrowserSession; addPage: (page: Page) => void } {
  let onPage: ((page: Page) => void) | undefined;
  const context = {
    on: (event: string, handler: (page: Page) => void) => {
      if (event === "page") onPage = handler;
    },
  } as unknown as BrowserContext;
  const session = new (BrowserSession as unknown as new (c: BrowserContext, p: Page) => BrowserSession)(context, initial);
  return { session, addPage: (page: Page) => onPage?.(page) };
}

describe("BrowserSession tab tracking", () => {
  it("forgets a tab that closes on its own", async () => {
    const flow = fakePage();
    const popup = fakePage();
    const { session, addPage } = fakeSession(flow);
    addPage(popup);
    expect(session.tabs).toHaveLength(2);

    await popup.close();

    expect(session.tabs).toEqual([flow]);
  });

  it("keeps activePage pointing at the surviving tab when an earlier one closes", async () => {
    const first = fakePage();
    const second = fakePage();
    const { session, addPage } = fakeSession(first);
    addPage(second);
    session.switchTab(1);

    await first.close();

    expect(session.activePage).toBe(second);
  });

  it("never hands back a dead Page, even before the close event lands", () => {
    const flow = fakePage();
    const brain = fakePage();
    const { session, addPage } = fakeSession(flow);
    addPage(brain);
    session.switchTab(1);

    // A crashed renderer: the tab is gone but nothing has notified us yet.
    // Returning it here is what produced "Target page, context or browser has
    // been closed" several actions later, far from the actual cause.
    brain.fire();

    expect(session.activePage).toBe(flow);
    expect(session.activePage.isClosed()).toBe(false);
  });

  it("does not double-remove a tab closed through closeTab()", async () => {
    const first = fakePage();
    const second = fakePage();
    const third = fakePage();
    const { session, addPage } = fakeSession(first);
    addPage(second);
    addPage(third);

    await session.closeTab(1);

    expect(session.tabs).toEqual([first, third]);
  });
});

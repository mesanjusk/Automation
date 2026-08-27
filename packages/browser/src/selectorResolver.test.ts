import { describe, expect, it, vi } from "vitest";
import { resolveTarget } from "./selectorResolver";
import type { Page } from "playwright";

function fakeLocator(succeeds: boolean, extra: Record<string, unknown> = {}) {
  const locator: any = {
    first: () => locator,
    nth: () => locator,
    filter: () => locator,
    count: async () => 1,
    isVisible: async () => true,
    isEditable: async () => true,
    waitFor: vi.fn(async () => {
      if (!succeeds) throw new Error("Timed out waiting for element");
    }),
    ...extra,
  };
  return locator;
}

/** Builds a fake Playwright Page where each strategy either resolves or times out per `succeedsAt`. */
function fakePage(succeedsAt: Set<string>, overrides: Record<string, unknown> = {}): Page {
  return {
    getByTestId: () => fakeLocator(succeedsAt.has("css-testid")),
    locator: () => fakeLocator(succeedsAt.has("css")),
    getByRole: () => fakeLocator(succeedsAt.has("role")),
    getByText: () => fakeLocator(succeedsAt.has("text")),
    getByLabel: () => fakeLocator(succeedsAt.has("aria-label")),
    ...overrides,
  } as unknown as Page;
}

describe("resolveTarget self-healing fallback", () => {
  it("uses the css selector when it resolves", async () => {
    const page = fakePage(new Set(["css"]));
    const { strategy } = await resolveTarget(page, { css: ".download-btn" }, { timeout: 10 });
    expect(strategy).toBe("css");
  });

  it("falls back to role when css fails", async () => {
    const page = fakePage(new Set(["role"]));
    const { strategy } = await resolveTarget(page, { css: ".download-btn", role: "button", text: "Download" }, { timeout: 10 });
    expect(strategy).toBe("role");
  });

  it("falls back to text when css and role both fail", async () => {
    const page = fakePage(new Set(["text"]));
    const { strategy } = await resolveTarget(
      page,
      { css: ".download-btn", role: "button", text: "Download Invoice" },
      { timeout: 10 }
    );
    expect(strategy).toBe("text");
  });

  it("falls back to aria-label after css, role and text fail", async () => {
    const page = fakePage(new Set(["aria-label"]));
    const { strategy } = await resolveTarget(
      page,
      { css: ".x", role: "button", text: "y", ariaLabel: "Download the invoice" },
      { timeout: 10 }
    );
    expect(strategy).toBe("aria-label");
  });

  it("uses AI visual identification only as the last resort", async () => {
    const page = fakePage(new Set());
    const visualFallback = vi.fn(async () => ({ x: 100, y: 200 }));
    const { strategy } = await resolveTarget(page, { css: ".x", text: "y" }, { timeout: 10, visualFallback });
    expect(strategy).toBe("ai-visual");
    expect(visualFallback).toHaveBeenCalledTimes(1);
  });

  it("throws with a descriptive error when every strategy fails and there is no visual fallback", async () => {
    const page = fakePage(new Set());
    await expect(resolveTarget(page, { css: ".x", text: "y" }, { timeout: 10 })).rejects.toThrow(
      /Could not resolve element target/
    );
  });
});

describe("resolveTarget element eligibility", () => {
  it("restricts matches to visible elements by default", async () => {
    const filter = vi.fn(() => fakeLocator(true));
    const page = fakePage(new Set(["css"]), {
      locator: () => fakeLocator(true, { filter }),
    });
    await resolveTarget(page, { css: "textarea, [contenteditable='true']" }, { timeout: 10 });
    expect(filter).toHaveBeenCalledWith({ visible: true });
  });

  it("does not filter by visibility when the target opts out", async () => {
    const filter = vi.fn(() => fakeLocator(true));
    const page = fakePage(new Set(["css"]), {
      locator: () => fakeLocator(true, { filter }),
    });
    await resolveTarget(page, { css: "textarea", visibleOnly: false }, { timeout: 10 });
    expect(filter).not.toHaveBeenCalled();
  });

  it("skips past visible-but-read-only matches when an editable target is required", async () => {
    // Two matches: the first is a read-only display node, the second the composer.
    const editability = [false, true];
    const candidate = fakeLocator(true, {
      count: async () => 2,
      isEditable: vi.fn(async () => true),
    });
    const parent: any = fakeLocator(true, {
      count: async () => 2,
      nth: (i: number) => fakeLocator(true, { isEditable: async () => editability[i] === true }),
    });
    parent.filter = () => parent;
    parent.first = () => candidate;
    const page = fakePage(new Set(["css"]), { locator: () => parent });

    const { strategy } = await resolveTarget(page, { css: "[contenteditable='true']", editable: true }, { timeout: 50 });
    expect(strategy).toBe("css");
  });

  it("ignores a css selector that interpolated to an empty string", async () => {
    const locator = vi.fn(() => fakeLocator(false));
    const page = fakePage(new Set(["role"]), { locator });
    const { strategy } = await resolveTarget(page, { css: "   ", role: "textbox" }, { timeout: 20 });
    expect(strategy).toBe("role");
    expect(locator).not.toHaveBeenCalled();
  });

  it("tries semantic strategies first when preferSemantic is set", async () => {
    const order: string[] = [];
    const page = fakePage(new Set(["role"]), {
      locator: () => {
        order.push("css");
        return fakeLocator(false);
      },
      getByRole: () => {
        order.push("role");
        return fakeLocator(true);
      },
    });
    await resolveTarget(page, { css: ".x", role: "button", preferSemantic: true }, { timeout: 20 });
    expect(order[0]).toBe("role");
  });
});

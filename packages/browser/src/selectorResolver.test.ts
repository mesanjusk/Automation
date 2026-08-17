import { describe, expect, it, vi } from "vitest";
import { resolveTarget } from "./selectorResolver.js";
import type { Page } from "playwright";

function fakeLocator(succeeds: boolean) {
  const locator: any = {
    first: () => locator,
    nth: () => locator,
    waitFor: vi.fn(async () => {
      if (!succeeds) throw new Error("Timed out waiting for element");
    }),
  };
  return locator;
}

/** Builds a fake Playwright Page where each strategy either resolves or times out per `succeedsAt`. */
function fakePage(succeedsAt: Set<string>): Page {
  return {
    getByTestId: () => fakeLocator(succeedsAt.has("css-testid")),
    locator: () => fakeLocator(succeedsAt.has("css")),
    getByRole: () => fakeLocator(succeedsAt.has("role")),
    getByText: () => fakeLocator(succeedsAt.has("text")),
    getByLabel: () => fakeLocator(succeedsAt.has("aria-label")),
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

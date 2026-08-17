import type { Page } from "playwright";
import type { AgentPageSnapshot } from "@bos/shared";

/**
 * Builds the context the AI agent reasons over: URL, title, visible text and
 * a lightweight accessibility outline. Deliberately excludes raw HTML/full
 * DOM to keep prompts small and to avoid ever leaking password field values.
 */
export async function buildPageSnapshot(page: Page): Promise<Omit<AgentPageSnapshot, "screenshotFileId">> {
  const [title, visibleText, accessibilityTree] = await Promise.all([
    page.title(),
    page.evaluate(() => document.body?.innerText?.slice(0, 8000) ?? ""),
    buildAccessibilityOutline(page),
  ]);
  return { url: page.url(), title, visibleText, accessibilityTree };
}

// Playwright removed the legacy page.accessibility.snapshot() API; the
// modern equivalent is Locator.ariaSnapshot(), which returns a compact
// YAML-like outline of roles/names — plenty for the AI agent to reason over.
async function buildAccessibilityOutline(page: Page): Promise<string> {
  try {
    const snapshot = await page.locator("body").ariaSnapshot({ ref: false } as never);
    return snapshot.slice(0, 4000);
  } catch {
    return "";
  }
}

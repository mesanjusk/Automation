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

async function buildAccessibilityOutline(page: Page): Promise<string> {
  try {
    const snapshot = await page.accessibility.snapshot({ interestingOnly: true });
    const lines: string[] = [];
    walk(snapshot, 0, lines);
    return lines.slice(0, 200).join("\n");
  } catch {
    return "";
  }
}

function walk(node: unknown, depth: number, out: string[]): void {
  if (!node || typeof node !== "object") return;
  const n = node as { role?: string; name?: string; children?: unknown[] };
  if (n.role && n.name) {
    out.push(`${"  ".repeat(depth)}${n.role}: ${n.name}`);
  }
  for (const child of n.children ?? []) walk(child, depth + 1, out);
}

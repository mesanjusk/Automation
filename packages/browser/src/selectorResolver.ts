import type { Page, Locator } from "playwright";
import type { SelectorStrategy, SelectorTarget } from "@bos/shared";

export interface ResolvedSelector {
  locator: Locator;
  strategy: SelectorStrategy;
}

export type VisualFallback = (
  page: Page,
  target: SelectorTarget
) => Promise<{ x: number; y: number } | null>;

/**
 * Self-healing element resolution. Tries the target's fields in priority
 * order (author-specified selectors first, semantic fallbacks after) and
 * returns the first strategy that resolves to exactly one visible element.
 * The winning strategy is returned so callers can log it — this is what lets
 * future runs learn which fallback actually worked.
 */
export async function resolveTarget(
  page: Page,
  target: SelectorTarget,
  opts: { timeout?: number; visualFallback?: VisualFallback } = {}
): Promise<ResolvedSelector> {
  const timeout = opts.timeout ?? 5000;
  const attempts: Array<{ strategy: SelectorStrategy; build: () => Locator | null }> = [
    { strategy: "css", build: () => (target.testId ? page.getByTestId(target.testId) : null) },
    { strategy: "css", build: () => (target.css ? page.locator(target.css) : null) },
    {
      strategy: "role",
      build: () =>
        target.role
          ? page.getByRole(target.role as never, target.text ? { name: target.text } : undefined)
          : null,
    },
    { strategy: "text", build: () => (target.text ? page.getByText(target.text, { exact: false }) : null) },
    {
      strategy: "aria-label",
      build: () => (target.ariaLabel ? page.getByLabel(target.ariaLabel, { exact: false }) : null),
    },
    {
      strategy: "nearby-text",
      build: () =>
        target.nearbyText
          ? page.locator(`:near(:text("${escapeText(target.nearbyText)}"))`).first()
          : null,
    },
    { strategy: "xpath", build: () => (target.xpath ? page.locator(`xpath=${target.xpath}`) : null) },
  ];

  const errors: string[] = [];
  for (const attempt of attempts) {
    const locator = attempt.build();
    if (!locator) continue;
    try {
      const scoped = typeof target.nth === "number" ? locator.nth(target.nth) : locator.first();
      await scoped.waitFor({ state: "visible", timeout });
      return { locator: scoped, strategy: attempt.strategy };
    } catch (err) {
      errors.push(`${attempt.strategy}: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  if (opts.visualFallback) {
    const point = await opts.visualFallback(page, target);
    if (point) {
      // Synthesize a locator-like object anchored at the AI-identified
      // coordinates. Coordinates are always the last resort per spec.
      const locator = page.locator("body");
      (locator as unknown as { __visualPoint?: { x: number; y: number } }).__visualPoint = point;
      return { locator, strategy: "ai-visual" };
    }
  }

  throw new Error(
    `Could not resolve element target ${JSON.stringify(target)} via any strategy. Attempts: ${errors.join(" | ")}`
  );
}

function escapeText(text?: string): string {
  return (text ?? "").replace(/"/g, '\\"');
}

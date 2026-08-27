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

/** Self-healing selector resolution with ONE total timeout budget. */
export async function resolveTarget(
  page: Page,
  target: SelectorTarget,
  opts: { timeout?: number; visualFallback?: VisualFallback } = {}
): Promise<ResolvedSelector> {
  const totalTimeout = Math.max(1000, opts.timeout ?? 5000);
  const started = Date.now();
  const attempts: Array<{ strategy: SelectorStrategy; build: () => Locator | null }> = [
    { strategy: "css", build: () => (target.testId ? page.getByTestId(target.testId) : null) },
    { strategy: "css", build: () => (target.css ? page.locator(target.css) : null) },
    { strategy: "role", build: () => target.role ? page.getByRole(target.role as never, target.text ? { name: target.text } : undefined) : null },
    { strategy: "text", build: () => (target.text ? page.getByText(target.text, { exact: false }) : null) },
    { strategy: "aria-label", build: () => (target.ariaLabel ? page.getByLabel(target.ariaLabel, { exact: false }) : null) },
    { strategy: "nearby-text", build: () => target.nearbyText ? page.locator(`:near(:text("${escapeText(target.nearbyText)}"))`).first() : null },
    { strategy: "xpath", build: () => (target.xpath ? page.locator(`xpath=${target.xpath}`) : null) },
  ];

  const usable = attempts.filter((a) => a.build() !== null);
  const errors: string[] = [];
  for (let index = 0; index < usable.length; index++) {
    const attempt = usable[index];
    const locator = attempt.build();
    if (!locator) continue;
    const remaining = totalTimeout - (Date.now() - started);
    if (remaining <= 0) break;
    const attemptsLeft = Math.max(1, usable.length - index);
    const attemptTimeout = Math.max(500, Math.min(remaining, Math.ceil(remaining / attemptsLeft)));
    try {
      const scoped = typeof target.nth === "number" ? locator.nth(target.nth) : locator.first();
      await scoped.waitFor({ state: "visible", timeout: attemptTimeout });
      return { locator: scoped, strategy: attempt.strategy };
    } catch (err) {
      errors.push(`${attempt.strategy}: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  const remaining = totalTimeout - (Date.now() - started);
  if (opts.visualFallback && remaining > 0) {
    const point = await Promise.race([
      opts.visualFallback(page, target),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), remaining)),
    ]);
    if (point) {
      const locator = page.locator("body");
      (locator as unknown as { __visualPoint?: { x: number; y: number } }).__visualPoint = point;
      return { locator, strategy: "ai-visual" };
    }
  }

  throw new Error(`Could not resolve element target ${JSON.stringify(target)} within ${totalTimeout}ms. Attempts: ${errors.join(" | ")}`);
}

function escapeText(text?: string): string {
  return (text ?? "").replace(/"/g, '\\"');
}

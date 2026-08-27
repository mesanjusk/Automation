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

/** Union selectors are common ("textarea, [contenteditable]") — never bind to a blank one. */
function usableString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Restricts a locator to elements that are actually rendered.
 *
 * Without this, `page.locator("textarea, [contenteditable='true']").first()`
 * binds to the first *DOM* match — routinely an offscreen or aria-only node on
 * an app shell — and then waits out the whole budget for something that will
 * never become visible, even though a perfectly good visible composer exists
 * further down the page.
 */
function visibleOnly(locator: Locator, enabled: boolean): Locator {
  return enabled ? locator.filter({ visible: true }) : locator;
}

async function pickCandidate(
  locator: Locator,
  target: SelectorTarget,
  timeout: number
): Promise<Locator> {
  if (typeof target.nth === "number") {
    const scoped = locator.nth(target.nth);
    await scoped.waitFor({ state: "visible", timeout });
    if (target.editable && !(await scoped.isEditable())) {
      throw new Error(`element at nth(${target.nth}) is not editable`);
    }
    return scoped;
  }

  await locator.first().waitFor({ state: "visible", timeout });
  if (!target.editable) return locator.first();

  // An editable target (a composer) may not be the first visible match — a
  // read-only display node can sit above it. Walk the matches instead.
  const total = await locator.count();
  for (let i = 0; i < Math.min(total, 10); i++) {
    const candidate = locator.nth(i);
    if ((await candidate.isVisible()) && (await candidate.isEditable())) return candidate;
  }
  throw new Error(`${total} element(s) matched but none were editable`);
}

/**
 * Self-healing selector resolution with ONE total timeout budget.
 *
 * Strategies are tried in order; `preferSemantic` puts the durable ones
 * (accessible role, visible text, aria-label) ahead of raw CSS, which is the
 * right order for app UIs that ship generated class names.
 */
export async function resolveTarget(
  page: Page,
  target: SelectorTarget,
  opts: { timeout?: number; visualFallback?: VisualFallback } = {}
): Promise<ResolvedSelector> {
  const totalTimeout = Math.max(1000, opts.timeout ?? 5000);
  const started = Date.now();
  const onlyVisible = target.visibleOnly !== false;
  const css = usableString(target.css);
  const text = usableString(target.text);
  const ariaLabel = usableString(target.ariaLabel);
  const role = usableString(target.role);
  const testId = usableString(target.testId);
  const xpath = usableString(target.xpath);
  const nearbyText = usableString(target.nearbyText);

  const semantic: Array<{ strategy: SelectorStrategy; build: () => Locator | null }> = [
    {
      strategy: "role",
      build: () =>
        role
          ? visibleOnly(page.getByRole(role as never, text ? { name: text } : undefined), onlyVisible)
          : null,
    },
    {
      strategy: "aria-label",
      build: () => (ariaLabel ? visibleOnly(page.getByLabel(ariaLabel, { exact: false }), onlyVisible) : null),
    },
    {
      strategy: "text",
      build: () => (text ? visibleOnly(page.getByText(text, { exact: false }), onlyVisible) : null),
    },
  ];

  const structural: Array<{ strategy: SelectorStrategy; build: () => Locator | null }> = [
    { strategy: "css", build: () => (testId ? visibleOnly(page.getByTestId(testId), onlyVisible) : null) },
    { strategy: "css", build: () => (css ? visibleOnly(page.locator(css), onlyVisible) : null) },
  ];

  const tail: Array<{ strategy: SelectorStrategy; build: () => Locator | null }> = [
    {
      strategy: "nearby-text",
      build: () =>
        nearbyText ? page.locator(`:near(:text("${escapeText(nearbyText)}"))`).first() : null,
    },
    { strategy: "xpath", build: () => (xpath ? page.locator(`xpath=${xpath}`) : null) },
  ];

  const attempts = target.preferSemantic
    ? [...semantic, ...structural, ...tail]
    : [...structural, ...semantic, ...tail];

  const usable = attempts.filter((a) => a.build() !== null);
  const errors: string[] = [];
  for (const [index, attempt] of usable.entries()) {
    const locator = attempt.build();
    if (!locator) continue;
    const remaining = totalTimeout - (Date.now() - started);
    if (remaining <= 0) break;
    const attemptsLeft = Math.max(1, usable.length - index);
    const attemptTimeout = Math.max(500, Math.min(remaining, Math.ceil(remaining / attemptsLeft)));
    try {
      const scoped = await pickCandidate(locator, target, attemptTimeout);
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

  const context = await describePage(page);
  throw new Error(
    `Could not resolve element target ${JSON.stringify(target)} within ${totalTimeout}ms. ` +
      `Attempts: ${errors.join(" | ")}.${context}`
  );
}

/**
 * Adds the page's identity and its real, visible controls to the failure
 * message. A bare "could not resolve" says nothing about *why*; knowing the
 * page was a Google sign-in screen, or listing the buttons that do exist,
 * usually answers it outright.
 */
async function describePage(page: Page): Promise<string> {
  try {
    const url = typeof page.url === "function" ? page.url() : "";
    const { probePage } = await import("./pageProbe");
    const report = await probePage(page, { maxElements: 20, maxTextLength: 400 });
    const controls = report.elements
      .slice(0, 12)
      .map((el) => `${el.role}"${el.name || el.text}"`)
      .join(", ");
    return ` Page: ${url || report.url} ("${report.title}"). Visible controls: ${controls || "none"}.`;
  } catch {
    try {
      return typeof page.url === "function" ? ` Page: ${page.url()}.` : "";
    } catch {
      return "";
    }
  }
}

function escapeText(text?: string): string {
  return (text ?? "").replace(/"/g, '\\"');
}

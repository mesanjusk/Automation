import type { Page, Locator, Frame, FrameLocator } from "playwright";
import type { SelectorStrategy, SelectorTarget } from "@bos/shared";
import { REF_ATTRIBUTE } from "./pageProbe";

export interface ResolvedSelector {
  locator: Locator;
  strategy: SelectorStrategy;
}

export type VisualFallback = (
  page: Page,
  target: SelectorTarget
) => Promise<{ x: number; y: number } | null>;

/** The subset of Page that FrameLocator also implements, so both can host a strategy. */
type LocatorRoot = Pick<Page, "locator" | "getByRole" | "getByText" | "getByLabel" | "getByTestId">;

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

/**
 * Scopes every strategy to the frame the element was discovered in.
 *
 * An element inside an iframe is unreachable from `page.locator()` — a
 * checkout form, an embedded editor or a third-party sign-in simply does not
 * exist as far as the main frame is concerned. The snapshot records which
 * frame each element came from; this puts the resolver back in it.
 */
function rootFor(page: Page, frame: string | undefined): LocatorRoot {
  if (!frame) return page;
  if (typeof page.frameLocator !== "function") return page;
  return page.frameLocator(frame) as FrameLocator as unknown as LocatorRoot;
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

interface Attempt {
  strategy: SelectorStrategy;
  build: () => Locator | null;
}

/** A stale ref is a DOM lookup that already failed; it must not eat the budget. */
const REF_BUDGET_MS = 1500;

/**
 * Binds a ref, searching every frame when the caller did not say which one.
 *
 * Refs are unique across the whole page, frames included, so an unqualified
 * ref is unambiguous — but `page.locator()` only ever sees the main frame. An
 * agent that reports `{"ref":"e12"}` for a control inside a payment iframe is
 * being precise, not sloppy, and this is what makes that work.
 */
async function resolveRef(
  page: Page,
  root: LocatorRoot,
  ref: string,
  target: SelectorTarget,
  budget: number,
  onlyVisible: boolean
): Promise<Locator | null> {
  const selector = `[${REF_ATTRIBUTE}="${cssEscape(ref)}"]`;

  // Only look past the scoped root when there is somewhere else to look, and
  // reserve budget for it up front: a missing element burns its whole slice
  // waiting, so letting the first attempt take everything would leave nothing
  // for the frames that actually hold the element.
  const others = target.frame ? [] : otherFrames(page);
  const primaryBudget = others.length > 0 ? Math.max(400, Math.floor(budget / 2)) : budget;

  try {
    return await pickCandidate(visibleOnly(root.locator(selector), onlyVisible), target, primaryBudget);
  } catch {
    /* not in the scoped root — fall through to the other frames */
  }

  const perFrame = Math.max(200, Math.floor((budget - primaryBudget) / Math.max(1, others.length)));
  for (const frame of others) {
    try {
      return await pickCandidate(visibleOnly(frame.locator(selector), onlyVisible), target, perFrame);
    } catch {
      /* try the next frame */
    }
  }
  return null;
}

/** Every frame except the main one, which the primary attempt already covered. */
function otherFrames(page: Page): Frame[] {
  if (typeof page.frames !== "function") return [];
  try {
    return page.frames().slice(1, 11);
  } catch {
    return [];
  }
}

/**
 * Self-healing selector resolution with ONE total timeout budget.
 *
 * `ref` comes first and is not negotiable: it is a handle stamped on the exact
 * DOM node the agent was shown, so when it resolves there is no ambiguity at
 * all. Everything after it is recovery for the case where the page re-rendered
 * and that node is gone — `preferSemantic` puts the durable hints (accessible
 * role, visible text, aria-label) ahead of raw CSS, which is the right order
 * for app UIs that ship generated class names.
 */
export async function resolveTarget(
  page: Page,
  target: SelectorTarget,
  opts: { timeout?: number; visualFallback?: VisualFallback } = {}
): Promise<ResolvedSelector> {
  const totalTimeout = Math.max(1000, opts.timeout ?? 5000);
  const started = Date.now();
  const onlyVisible = target.visibleOnly !== false;
  const ref = usableString(target.ref);
  const frame = usableString(target.frame);
  const root = rootFor(page, frame);
  const css = usableString(target.css);
  const text = usableString(target.text);
  const ariaLabel = usableString(target.ariaLabel);
  const role = usableString(target.role);
  const testId = usableString(target.testId);
  const xpath = usableString(target.xpath);
  const nearbyText = usableString(target.nearbyText);

  // A ref either exists in the DOM right now or it does not; there is nothing
  // to wait out. Trying it first and separately keeps a stale ref from eating
  // the budget the fallback strategies need.
  let refWasStale = false;
  if (ref) {
    const budget = Math.min(totalTimeout, REF_BUDGET_MS);
    const scoped = await resolveRef(page, root, ref, target, budget, onlyVisible);
    if (scoped) return { locator: scoped, strategy: "ref" };
    refWasStale = true;
  }

  const semantic: Attempt[] = [
    {
      strategy: "role",
      build: () =>
        role
          ? visibleOnly(root.getByRole(role as never, text ? { name: text } : undefined), onlyVisible)
          : null,
    },
    {
      strategy: "aria-label",
      build: () => (ariaLabel ? visibleOnly(root.getByLabel(ariaLabel, { exact: false }), onlyVisible) : null),
    },
    {
      strategy: "text",
      build: () => (text ? visibleOnly(root.getByText(text, { exact: false }), onlyVisible) : null),
    },
  ];

  const structural: Attempt[] = [
    { strategy: "css", build: () => (testId ? visibleOnly(root.getByTestId(testId), onlyVisible) : null) },
    { strategy: "css", build: () => (css ? visibleOnly(root.locator(css), onlyVisible) : null) },
  ];

  const tail: Attempt[] = [
    {
      strategy: "nearby-text",
      build: () =>
        nearbyText ? root.locator(`:near(:text("${escapeText(nearbyText)}"))`).first() : null,
    },
    { strategy: "xpath", build: () => (xpath ? root.locator(`xpath=${xpath}`) : null) },
  ];

  const attempts = target.preferSemantic
    ? [...semantic, ...structural, ...tail]
    : [...structural, ...semantic, ...tail];

  const usable = attempts.filter((a) => a.build() !== null);
  const errors: string[] = [];
  if (refWasStale) errors.push(`ref: "${ref}" is not in the DOM`);
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

  const staleNote = refWasStale
    ? ` Element ref "${ref}" is stale — the page re-rendered since the snapshot that produced it. Take a fresh snapshot and use a ref from that one.`
    : "";
  const context = await describePage(page);
  throw new Error(
    `Could not resolve element target ${JSON.stringify(target)} within ${totalTimeout}ms. ` +
      `Attempts: ${errors.join(" | ")}.${staleNote}${context}`
  );
}

/**
 * Adds the page's identity and its real, visible controls to the failure
 * message. A bare "could not resolve" says nothing about *why*; knowing the
 * page was a Google sign-in screen, or listing the refs that do exist, usually
 * answers it outright — and the refs are directly usable in the next attempt.
 */
async function describePage(page: Page): Promise<string> {
  try {
    const url = typeof page.url === "function" ? page.url() : "";
    const { probePage } = await import("./pageProbe");
    const report = await probePage(page, { maxElements: 20, maxTextLength: 400 });
    const controls = report.elements
      .slice(0, 12)
      .map((el) => `[${el.ref}] ${el.role}"${el.name || el.text}"`)
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

/** Refs are `e<digits>`, but never build a selector by trusting that. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function escapeText(text?: string): string {
  return (text ?? "").replace(/"/g, '\\"');
}

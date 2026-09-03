import type { Page } from "playwright";

export interface StabilityOptions {
  /** Hard cap. The wait always returns within this, settled or not. */
  timeoutMs?: number;
  /** How long the DOM must stop mutating before the page counts as settled. */
  quietMs?: number;
  /** Also wait for network to go idle. Off for SPAs that poll forever. */
  networkIdle?: boolean;
}

export interface StabilityResult {
  settled: boolean;
  waitedMs: number;
  reason: string;
}

/**
 * Waits until the page has stopped changing, or the budget runs out.
 *
 * This is the difference between an agent that reads a page and one that reads
 * a *half-rendered* page. Without it, an observation taken immediately after a
 * click captures the old DOM (so the agent thinks its click did nothing and
 * clicks again) or a skeleton loader (so it reports the control it needs is
 * missing). Both failure modes look like a flaky site and are really a missing
 * wait.
 *
 * Deliberately not `networkidle` by default: modern apps hold open analytics
 * beacons, websockets and long-poll requests that never go idle, so keying off
 * the network alone would burn the whole budget on every step. DOM quiescence
 * is what actually correlates with "the page is done reacting to me".
 */
export async function waitForPageStable(page: Page, opts: StabilityOptions = {}): Promise<StabilityResult> {
  const timeoutMs = Math.max(100, opts.timeoutMs ?? 5000);
  const quietMs = Math.max(50, Math.min(opts.quietMs ?? 400, timeoutMs));
  const started = Date.now();

  try {
    await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
  } catch {
    /* Still loading, or the frame navigated mid-wait. Mutation quiescence below decides. */
  }

  if (opts.networkIdle) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining > 0) {
      await page.waitForLoadState("networkidle", { timeout: remaining }).catch(() => undefined);
    }
  }

  const remaining = timeoutMs - (Date.now() - started);
  if (remaining <= 0) return { settled: false, waitedMs: Date.now() - started, reason: "budget spent before DOM check" };

  // Evaluated as a string expression on purpose: a serialised callback picks up
  // the esbuild `__name` helper that does not exist in the page realm (the same
  // trap pageProbe documents), and a string has no such closure.
  const script = `new Promise((resolve) => {
    const quietMs = ${Math.min(quietMs, remaining)};
    const deadline = Date.now() + ${remaining};
    let timer = null;
    const done = (reason) => {
      try { observer.disconnect(); } catch {}
      if (timer) clearTimeout(timer);
      clearInterval(guard);
      resolve(reason);
    };
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => done("quiet"), quietMs);
    };
    const observer = new MutationObserver(arm);
    const guard = setInterval(() => { if (Date.now() >= deadline) done("timeout"); }, 50);
    try {
      observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    } catch (err) {
      done("unobservable");
      return;
    }
    arm();
  })`;

  let reason = "quiet";
  try {
    reason = (await page.evaluate(script)) as string;
  } catch (err) {
    // A navigation destroys the execution context mid-wait. That is not a
    // failure — it means the page moved on, which is exactly what we were
    // waiting to find out.
    reason = /execution context|destroyed|navigat/i.test((err as Error).message) ? "navigated" : "unavailable";
  }

  return { settled: reason === "quiet" || reason === "navigated", waitedMs: Date.now() - started, reason };
}

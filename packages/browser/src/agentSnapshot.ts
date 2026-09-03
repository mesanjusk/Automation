import type { Page } from "playwright";
import type { AgentPageSnapshot, AgentSnapshotElement, SelectorTarget } from "@bos/shared";
import { probePage, type PageProbeReport, type ProbedElement } from "./pageProbe";
import { waitForPageStable } from "./pageStability";

/**
 * What the agent is shown each turn, plus the full-fidelity report behind it.
 *
 * `page` is the model-facing half — a ref-labelled outline of the live DOM.
 * `report` is kept so the caller can turn a ref back into an exact target and
 * diff this observation against the previous one without re-probing.
 */
export interface AgentSnapshot {
  page: AgentPageSnapshot;
  report: PageProbeReport;
}

export interface AgentSnapshotOptions {
  maxElements?: number;
  maxTextLength?: number;
  /** Wait for the DOM to stop mutating first. Set 0 to observe immediately. */
  stabilityMs?: number;
  /** Open tabs, so the agent can address tab switches by index rather than guessing. */
  tabs?: Array<{ index: number; url: string; title: string; active: boolean }>;
}

/** Roles with no matching power — every plain div on the page is "generic". */
const UNSELECTABLE_ROLES = new Set(["", "generic", "none", "presentation"]);

/**
 * Observes the page the way a browser-extension agent does: settle first, then
 * capture one ref-labelled snapshot that is the single source of truth for the
 * turn. Everything the model is allowed to act on appears here with a handle,
 * so "click the Continue button" becomes "click e14" — an exact instruction
 * rather than a description that has to be re-derived and can re-derive wrong.
 */
export async function captureAgentSnapshot(page: Page, opts: AgentSnapshotOptions = {}): Promise<AgentSnapshot> {
  const stabilityMs = opts.stabilityMs ?? 2500;
  if (stabilityMs > 0) await waitForPageStable(page, { timeoutMs: stabilityMs });

  const report = await probePage(page, {
    maxElements: opts.maxElements ?? 120,
    maxTextLength: opts.maxTextLength ?? 6000,
  });

  const elements: AgentSnapshotElement[] = report.elements.map((el) => ({
    ref: el.ref,
    role: el.role,
    name: el.name || el.text,
    tag: el.tag,
    editable: el.editable || undefined,
    disabled: el.disabled || undefined,
    inViewport: el.inViewport,
    frame: el.frame ?? undefined,
    value: el.value ?? undefined,
  }));

  return {
    report,
    page: {
      url: report.url,
      title: report.title,
      visibleText: report.visibleText,
      outline: renderOutline(report),
      elements,
      notices: collectNotices(report),
      tabs: opts.tabs,
      scroll: {
        y: report.scroll.y,
        height: report.scroll.height,
        viewport: report.scroll.viewport,
        atBottom: report.scroll.atBottom,
      },
    },
  };
}

/**
 * Renders the controls as one ref-labelled list.
 *
 * Format is deliberately terse and uniform — one line per control, ref first —
 * because a model copies what it can see cleanly. Flags that change what an
 * action will do (editable, disabled, off-screen, which frame) are on the line;
 * pixel geometry and generated CSS paths are not, since they invite the model
 * to reason about coordinates instead of about the page.
 */
export function renderOutline(report: PageProbeReport, limit = 100): string {
  const lines: string[] = [];
  for (const el of report.elements.slice(0, limit)) {
    const flags: string[] = [];
    if (el.editable) flags.push("editable");
    if (el.disabled) flags.push("disabled");
    if (!el.inViewport) flags.push("off-screen");
    if (el.checked === true) flags.push("checked");
    if (el.expanded === true) flags.push("expanded");
    if (el.expanded === false) flags.push("collapsed");
    if (el.frame) flags.push(`frame=${el.frame}`);
    const name = (el.name || el.text || "").trim();
    const value = el.value && el.value !== name ? ` value=${JSON.stringify(el.value.slice(0, 80))}` : "";
    const href = el.href && el.href.length < 120 ? ` -> ${el.href}` : "";
    lines.push(
      `[${el.ref}] ${el.role || el.tag} ${JSON.stringify(name.slice(0, 120))}${value}${href}${flags.length ? ` (${flags.join(", ")})` : ""}`
    );
  }
  if (report.elements.length > limit) {
    lines.push(`… ${report.elements.length - limit} more controls not listed — scroll or narrow the page to see them.`);
  }
  return lines.join("\n") || "(no interactive controls are visible)";
}

/** Things a person would read before touching anything: modals, alerts, blocked frames. */
export function collectNotices(report: PageProbeReport): string[] {
  const notices: string[] = [];
  for (const dialog of report.dialogs) notices.push(`Modal dialog open: "${dialog.slice(0, 200)}"`);
  for (const live of report.liveRegions.slice(0, 5)) notices.push(`Status message: "${live}"`);
  if (report.inaccessibleFrames > 0) {
    notices.push(
      `${report.inaccessibleFrames} cross-origin iframe(s) could not be read — anything inside them is invisible to you.`
    );
  }
  if (report.readyState !== "complete") notices.push(`Page is still loading (readyState=${report.readyState}).`);
  if (!report.scroll.atBottom && report.scroll.height > report.scroll.viewport * 1.2) {
    notices.push(`More page below the fold (${report.scroll.y}px of ${report.scroll.height}px scrolled).`);
  }
  return notices;
}

/**
 * Describes what actually changed between two observations.
 *
 * An agent with no feedback loop repeats itself: it clicks, sees a page that
 * looks the same, and clicks again. Handing it the diff — "URL unchanged, no
 * controls appeared or disappeared" — is what turns a silent no-op into a
 * signal it can act on, and it is cheap because refs make identity exact.
 */
export function describeChanges(before: PageProbeReport | undefined, after: PageProbeReport): string {
  if (!before) return "First observation of this page.";
  const changes: string[] = [];

  if (before.url !== after.url) changes.push(`URL changed: ${before.url} -> ${after.url}`);
  if (before.title !== after.title) changes.push(`Title changed: "${before.title}" -> "${after.title}"`);

  const beforeRefs = new Map(before.elements.map((el) => [el.ref, el]));
  const afterRefs = new Map(after.elements.map((el) => [el.ref, el]));
  const appeared = after.elements.filter((el) => !beforeRefs.has(el.ref));
  const gone = before.elements.filter((el) => !afterRefs.has(el.ref));
  const label = (el: ProbedElement): string => `${el.role} "${(el.name || el.text).slice(0, 60)}"`;

  if (appeared.length) changes.push(`${appeared.length} new control(s): ${appeared.slice(0, 6).map(label).join(", ")}`);
  if (gone.length) changes.push(`${gone.length} control(s) gone: ${gone.slice(0, 6).map(label).join(", ")}`);

  for (const el of after.elements) {
    const previous = beforeRefs.get(el.ref);
    if (!previous) continue;
    if (previous.value !== el.value) changes.push(`${label(el)} value is now ${JSON.stringify(el.value ?? "")}`);
    else if (previous.disabled !== el.disabled) changes.push(`${label(el)} is now ${el.disabled ? "disabled" : "enabled"}`);
    else if (previous.checked !== el.checked && el.checked !== null) changes.push(`${label(el)} is now ${el.checked ? "checked" : "unchecked"}`);
    else if (previous.expanded !== el.expanded && el.expanded !== null) changes.push(`${label(el)} is now ${el.expanded ? "expanded" : "collapsed"}`);
  }

  const newDialogs = after.dialogs.filter((d) => !before.dialogs.includes(d));
  if (newDialogs.length) changes.push(`Dialog opened: "${newDialogs[0]?.slice(0, 160)}"`);
  else if (before.dialogs.length && after.dialogs.length === 0) changes.push("Dialog closed.");

  const newStatus = after.liveRegions.filter((r) => !before.liveRegions.includes(r));
  if (newStatus.length) changes.push(`New status message: "${newStatus[0]}"`);

  if (before.media.playableVideos !== after.media.playableVideos) {
    changes.push(`Playable videos: ${before.media.playableVideos} -> ${after.media.playableVideos}`);
  }
  if (Math.abs(before.scroll.y - after.scroll.y) > 20) changes.push(`Scrolled from ${before.scroll.y}px to ${after.scroll.y}px`);

  if (changes.length === 0) {
    return "NOTHING CHANGED on the page — same URL, same controls, same values. Your last action had no visible effect.";
  }
  return changes.slice(0, 10).join("; ");
}

export function elementByRef(report: PageProbeReport, ref: string): ProbedElement | undefined {
  return report.elements.find((el) => el.ref === ref);
}

/**
 * Turns a probed element into a target the resolver can bind.
 *
 * The ref leads because it is exact. Everything after it exists for the case
 * where the page re-rendered between the snapshot and the click and the node
 * carrying the ref is gone: role and accessible name survive most re-renders,
 * and `cssPath` — up to twelve levels of positional `nth-child` — is the last
 * resort precisely because it is the first thing a re-render invalidates.
 */
export function targetForElement(el: ProbedElement, all: ProbedElement[] = []): SelectorTarget {
  const role = UNSELECTABLE_ROLES.has(el.role) ? undefined : el.role;
  const name = (el.name || el.text || "").trim();
  const target: SelectorTarget = { preferSemantic: true };

  if (el.ref) target.ref = el.ref;
  if (el.frame) target.frame = el.frame;
  if (role) target.role = role;
  if (name) target.text = name;
  if (el.ariaLabel) target.ariaLabel = el.ariaLabel;
  if (el.editable) target.editable = true;

  const twins =
    role || name
      ? all.filter((candidate) => {
          const candidateRole = UNSELECTABLE_ROLES.has(candidate.role) ? undefined : candidate.role;
          return candidateRole === role && (candidate.name || candidate.text || "").trim() === name;
        })
      : [];

  if (twins.length > 1) {
    // The page renders one identical control per row/card, so the name alone is
    // not a handle for the fallback path. `nth` indexes into a strategy's match
    // set — the probe walks visible elements in DOM order, the same order
    // Playwright indexes — so it only means something for strategies that match
    // many elements. A unique cssPath asked for nth(3) resolves to nothing, so
    // it is left off here.
    target.nth = twins.indexOf(el);
    return target;
  }

  if (el.testId) target.testId = el.testId;
  target.css = el.cssPath;
  return target;
}

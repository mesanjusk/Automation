import { FLOW_STATES, type FlowState } from "@bos/shared";
import type { PageProbeReport, ProbedElement } from "./pageProbe";

/**
 * Every signal the Flow classifier uses is *text* — accessible names, ARIA
 * labels, placeholders and visible copy — never a CSS class or a DOM path.
 * Text is the part of a UI that stays meaningful when Google reships the app,
 * and it is the part a human reading a screenshot would use too. Adjusting the
 * driver to a Flow redesign is a data edit in this table, not a code change.
 */
export const FLOW_SIGNALS = {
  loginUrl: /accounts\.google\.com|consent\.google\.com|\/signin|\/ServiceLogin|\/AccountChooser|\/o\/oauth2\//i,
  loginText: [
    /^sign in$/i,
    /sign in to continue/i,
    /sign in with google/i,
    /continue with google/i,
    /choose an account/i,
    /use another account/i,
    /^log in$/i,
    /verify it['’]s you/i,
    /couldn['’]t sign you in/i,
    /to continue to .*flow/i,
  ],
  landingCta: [
    /create with (google )?flow/i,
    /try (google )?flow/i,
    /start creating/i,
    /^get started$/i,
    /^open flow$/i,
    /^try it now$/i,
  ],
  workspaceCta: [
    /^new project$/i,
    /^new video$/i,
    /create (a )?new project/i,
    /^untitled project$/i,
    /^start a new project$/i,
  ],
  workspaceText: [/my projects/i, /your projects/i, /recent projects/i, /^projects$/im],
  promptHint: [
    /generate a video/i,
    /describe (your|the)/i,
    /prompt/i,
    /what do you want/i,
    /type (a|your)/i,
    /create a video/i,
    /your idea/i,
    /^ask flow/i,
    /text to video/i,
    /scene description/i,
  ],
  searchHint: [/^search$/i, /search projects/i, /search\b/i],
  submitHint: [
    /^generate$/i,
    /^create$/i,
    /^send$/i,
    /^submit$/i,
    /generate video/i,
    /^run$/i,
    /^go$/i,
    /arrow_upward/i,
    /^send (message|prompt)$/i,
  ],
  submitAvoid: [/cancel/i, /close/i, /back/i, /settings/i, /help/i, /feedback/i, /sign out/i, /delete/i, /^clear$/i],
  generatingText: [
    /generating/i,
    /creating your video/i,
    /rendering/i,
    /processing/i,
    /working on it/i,
    /this (may|can|will) take/i,
    /in progress/i,
    /^queued$/i,
    /please wait/i,
  ],
  readyText: [/your video is ready/i, /^download$/i, /generation complete/i, /^add to scene$/i, /^extend$/i],
  errorText: [
    /something went wrong/i,
    /try again later/i,
    /an error occurred/i,
    /failed to generate/i,
    /generation failed/i,
    /out of (credits|generations)/i,
    /you['’ ]?(ve| have) (run out|reached)/i,
    /rate limit/i,
    /not available in your (country|region)/i,
    /unable to (generate|complete)/i,
    /quota (exceeded|reached)/i,
    /content (policy|guidelines)/i,
  ],
} as const;

export interface FlowClassification {
  state: FlowState;
  reason: string;
  matchedSignals: string[];
  /** The real prompt input discovered on the page, if one is present. */
  composer?: ProbedElement;
  /** The control that submits the composer, if one is present. */
  submit?: ProbedElement;
  /** The control that advances the app toward the generation UI (LANDING/WORKSPACE). */
  primaryAction?: ProbedElement;
  errorText?: string;
  url: string;
  title: string;
}

/** Minimum score for an editable element to count as the prompt composer. */
const COMPOSER_MIN_SCORE = 25;

function matchAny(patterns: readonly RegExp[], value: string): RegExp | undefined {
  if (!value) return undefined;
  return patterns.find((pattern) => pattern.test(value));
}

function elementHaystack(el: ProbedElement): string {
  return [el.name, el.ariaLabel ?? "", el.placeholder ?? "", el.text, el.attrs["aria-label"] ?? ""]
    .filter(Boolean)
    .join(" | ");
}

function area(el: ProbedElement): number {
  return el.rect.width * el.rect.height;
}

function centre(el: ProbedElement): { x: number; y: number } {
  return { x: el.rect.x + el.rect.width / 2, y: el.rect.y + el.rect.height / 2 };
}

/**
 * Picks the real prompt input out of everything editable on the page.
 * Scores by accessible-name/placeholder meaning, size and position — a
 * composer is large, sits low, and says something about prompts; a site
 * search box says "search" and sits in the header.
 */
export function findComposer(report: PageProbeReport): ProbedElement | undefined {
  const candidates = report.elements.filter(
    (el) =>
      el.visible &&
      el.editable &&
      !el.disabled &&
      (el.role === "textbox" || el.role === "searchbox" || el.tag === "textarea" || el.attrs["contenteditable"] !== undefined)
  );
  if (candidates.length === 0) return undefined;

  let best: { el: ProbedElement; score: number } | undefined;
  for (const el of candidates) {
    const haystack = elementHaystack(el);
    let score = 0;
    if (matchAny(FLOW_SIGNALS.promptHint, haystack)) score += 45;
    if (el.role === "searchbox" || matchAny(FLOW_SIGNALS.searchHint, haystack)) score -= 60;
    if (el.tag === "textarea" || el.attrs["contenteditable"] !== undefined) score += 15;
    score += Math.min(30, area(el) / 800);
    // Composers live near the bottom of the app shell; header inputs do not.
    if (el.rect.y > 200) score += 12;
    if (el.rect.width > 300) score += 8;
    if (!el.inViewport) score -= 10;
    if (!best || score > best.score) best = { el, score };
  }
  // A composer either says what it is (a prompt hint) or looks the part (large,
  // low on the page, multiline). A small anonymous input — a login email field,
  // a rename box — clears neither bar and must not be mistaken for one.
  return best && best.score >= COMPOSER_MIN_SCORE ? best.el : undefined;
}

/** Finds the control that submits the composer: meaning first, proximity second. */
export function findSubmit(report: PageProbeReport, composer?: ProbedElement): ProbedElement | undefined {
  const candidates = report.elements.filter(
    (el) => el.visible && (el.role === "button" || el.role === "link" || el.tag === "button") && !el.editable
  );
  if (candidates.length === 0) return undefined;

  const composerCentre = composer ? centre(composer) : undefined;
  let best: { el: ProbedElement; score: number } | undefined;
  for (const el of candidates) {
    const haystack = elementHaystack(el);
    let score = 0;
    if (matchAny(FLOW_SIGNALS.submitHint, haystack)) score += 50;
    if (el.type === "submit") score += 25;
    if (matchAny(FLOW_SIGNALS.submitAvoid, haystack)) score -= 60;
    if (el.disabled) score -= 20;
    if (composerCentre) {
      const point = centre(el);
      const distance = Math.hypot(point.x - composerCentre.x, point.y - composerCentre.y);
      score += Math.max(0, 35 - distance / 20);
    }
    if (!best || score > best.score) best = { el, score };
  }
  return best && best.score > 10 ? best.el : undefined;
}

/** Highest-scoring visible, enabled control whose accessible name matches one of the hints. */
export function findAction(report: PageProbeReport, hints: readonly RegExp[]): ProbedElement | undefined {
  let best: { el: ProbedElement; score: number } | undefined;
  for (const el of report.elements) {
    if (!el.visible || el.disabled || el.editable) continue;
    if (el.role !== "button" && el.role !== "link" && el.tag !== "button" && el.tag !== "a") continue;
    const hit = matchAny(hints, elementHaystack(el));
    if (!hit) continue;
    const score = 100 - hints.indexOf(hit) * 5 + Math.min(20, area(el) / 500);
    if (!best || score > best.score) best = { el, score };
  }
  return best?.el;
}

function textSignals(report: PageProbeReport, patterns: readonly RegExp[]): string[] {
  const haystacks = [report.visibleText, ...report.liveRegions];
  const hits: string[] = [];
  for (const pattern of patterns) {
    for (const haystack of haystacks) {
      const match = haystack.match(pattern);
      if (match) {
        hits.push(match[0]);
        break;
      }
    }
  }
  return hits;
}

/**
 * Turns a live probe into one of the states the driver knows how to act on.
 *
 * Order matters and is deliberate: an active generation outranks a stale error
 * toast, a discovered composer outranks marketing copy that happens to still be
 * in the DOM, and "New project" (specific) outranks "Get started" (generic).
 */
export function classifyFlowState(report: PageProbeReport): FlowClassification {
  const base = { url: report.url, title: report.title };

  if (FLOW_SIGNALS.loginUrl.test(report.url)) {
    return {
      ...base,
      state: "LOGIN_REQUIRED",
      reason: `URL is a Google account/consent screen (${report.url})`,
      matchedSignals: ["loginUrl"],
    };
  }

  const composer = findComposer(report);
  const submit = findSubmit(report, composer);
  const generating = textSignals(report, FLOW_SIGNALS.generatingText);
  const errors = textSignals(report, FLOW_SIGNALS.errorText);
  const ready = textSignals(report, FLOW_SIGNALS.readyText);

  if (generating.length > 0 || (report.media.progressBars > 0 && composer)) {
    return {
      ...base,
      state: "GENERATING",
      reason: generating.length ? `Generation in progress: "${generating[0]}"` : "A progress indicator is active",
      matchedSignals: generating.length ? generating : ["progressbar"],
      composer,
      submit,
    };
  }

  if (errors.length > 0) {
    return {
      ...base,
      state: "ERROR",
      reason: `Flow reported an error: "${errors[0]}"`,
      matchedSignals: errors,
      errorText: errors.join(" | "),
      composer,
      submit,
    };
  }

  if (composer) {
    const hasResult = report.media.playableVideos > 0 || ready.length > 0;
    if (hasResult) {
      return {
        ...base,
        state: "CLIP_READY",
        reason: ready.length
          ? `Finished clip is available: "${ready[0]}"`
          : `${report.media.playableVideos} playable video element(s) present`,
        matchedSignals: ready.length ? ready : ["playableVideos"],
        composer,
        submit,
      };
    }
    return {
      ...base,
      state: "GENERATION_UI",
      reason: `Prompt composer discovered: ${composer.role} "${composer.name}" at ${composer.cssPath}`,
      matchedSignals: ["composer"],
      composer,
      submit,
    };
  }

  // A control that creates a project is the strongest workspace evidence there
  // is. Workspace *copy* alone is weaker than a landing CTA — a marketing page
  // with a "Projects" nav link would otherwise be misread as the workspace and
  // then stall, because that page has nothing to click to create anything.
  const workspaceAction = findAction(report, FLOW_SIGNALS.workspaceCta);
  if (workspaceAction) {
    return {
      ...base,
      state: "WORKSPACE",
      reason: `Project workspace control discovered: "${workspaceAction.name}" at ${workspaceAction.cssPath}`,
      matchedSignals: ["workspaceCta"],
      primaryAction: workspaceAction,
    };
  }

  const landingAction = findAction(report, FLOW_SIGNALS.landingCta);
  if (landingAction) {
    return {
      ...base,
      state: "LANDING",
      reason: `Public Flow landing page; entry control "${landingAction.name}" at ${landingAction.cssPath}`,
      matchedSignals: ["landingCta"],
      primaryAction: landingAction,
    };
  }

  if (textSignals(report, FLOW_SIGNALS.workspaceText).length > 0) {
    return {
      ...base,
      state: "WORKSPACE",
      reason: "Project list copy is on screen but no create control could be discovered",
      matchedSignals: ["workspaceText"],
    };
  }

  const loginAction = findAction(report, FLOW_SIGNALS.loginText);
  if (loginAction || textSignals(report, FLOW_SIGNALS.loginText).length > 0) {
    return {
      ...base,
      state: "LOGIN_REQUIRED",
      reason: loginAction
        ? `Sign-in control is the only way forward: "${loginAction.name}"`
        : "Sign-in copy is on screen and no Flow controls were found",
      matchedSignals: ["loginText"],
      primaryAction: loginAction,
    };
  }

  if (report.readyState !== "complete" || report.elements.length < 3) {
    return {
      ...base,
      state: "LOADING",
      reason: `Page is still coming up (readyState=${report.readyState}, ${report.elements.length} visible controls)`,
      matchedSignals: [],
    };
  }

  return {
    ...base,
    state: "UNKNOWN",
    reason: `No known Flow screen matched (${report.elements.length} visible controls, ${report.hiddenInteractiveCount} hidden)`,
    matchedSignals: [],
  };
}

/**
 * Validates state names coming from a stored workflow definition.
 *
 * A typo'd state would otherwise match nothing and present as a mysterious
 * timeout minutes later; failing here names the offending value instead.
 */
export function toFlowStates(values: readonly string[] | undefined, fallback: FlowState[] = []): FlowState[] {
  if (!values || values.length === 0) return fallback;
  const known = new Set<string>(FLOW_STATES);
  const bad = values.filter((value) => !known.has(value));
  if (bad.length > 0) {
    throw new Error(`Unknown Flow state(s) ${bad.join(", ")}. Valid states: ${FLOW_STATES.join(", ")}`);
  }
  return values as FlowState[];
}

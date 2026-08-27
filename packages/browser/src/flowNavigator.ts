import type { Page } from "playwright";
import { AutomationError, type FlowState } from "@bos/shared";
import type { BrowserSession } from "./session";
import { probePage, summariseProbe, type PageProbeReport } from "./pageProbe";
import { classifyFlowState, type FlowClassification } from "./flowState";

export type EmitScreenshot = (
  name: string,
  buffer: Buffer,
  meta?: Record<string, unknown>
) => Promise<void> | void;

export interface FlowDriverHooks {
  emitScreenshot?: EmitScreenshot;
  log?: (message: string) => void;
}

export interface FlowObservation {
  classification: FlowClassification;
  report: PageProbeReport;
}

/** Named screenshots the dashboard is expected to show for every Flow run. */
export const FLOW_SCREENSHOTS = {
  landing: "flow_landing",
  afterCreate: "flow_after_create",
  workspace: "flow_workspace",
  generationUi: "flow_generation_ui",
  promptSubmitted: "flow_prompt_submitted",
  generating: "flow_generating",
  clipComplete: "flow_clip_complete",
  error: "flow_error",
} as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One probe + classification of whatever Flow is currently showing. */
export async function observeFlow(page: Page): Promise<FlowObservation> {
  const report = await probePage(page);
  return { report, classification: classifyFlowState(report) };
}

async function capture(
  page: Page,
  hooks: FlowDriverHooks,
  name: string,
  observation: FlowObservation
): Promise<void> {
  if (!hooks.emitScreenshot) return;
  try {
    const buffer = await page.screenshot({ fullPage: false });
    await hooks.emitScreenshot(name, buffer, {
      state: observation.classification.state,
      reason: observation.classification.reason,
      url: observation.report.url,
      title: observation.report.title,
    });
  } catch (err) {
    hooks.log?.(`Could not capture "${name}" screenshot: ${(err as Error).message}`);
  }
}

function loginRequired(observation: FlowObservation, stepId?: string): AutomationError {
  return new AutomationError({
    errorCode: "GOOGLE_LOGIN_REQUIRED",
    message:
      "Google Flow needs an authenticated Google session. The browser profile in use is showing a Google sign-in/consent screen, " +
      "so no Flow controls exist to interact with. Log this browser profile in to Google Flow once (npm run connect-browser), " +
      "then re-run the task.",
    category: "HUMAN_INTERVENTION_REQUIRED",
    retryable: false,
    stepId,
    details: {
      flowState: observation.classification.state,
      reason: observation.classification.reason,
      url: observation.report.url,
      title: observation.report.title,
    },
  });
}

function unknownScreen(observation: FlowObservation, stepId: string | undefined, context: string): AutomationError {
  return new AutomationError({
    errorCode: "FLOW_UNKNOWN_SCREEN",
    message:
      `${context} Flow is showing a screen this driver does not recognise. ` +
      `Discovered controls are listed in the step output and the flow_error screenshot.`,
    category: "WEBSITE_CHANGED",
    retryable: false,
    stepId,
    details: {
      flowState: observation.classification.state,
      reason: observation.classification.reason,
      url: observation.report.url,
      title: observation.report.title,
      discovered: summariseProbe(observation.report, 30),
    },
  });
}

export interface WaitForFlowStateOptions extends FlowDriverHooks {
  states: FlowState[];
  failStates?: FlowState[];
  timeoutMs: number;
  pollMs?: number;
  stepId?: string;
  screenshotName?: string;
  /** Treat LOGIN_REQUIRED as a hard, clearly-labelled failure (default true). */
  failOnLoginRequired?: boolean;
  /**
   * Only accept a finished clip that this wait actually watched appear.
   *
   * From the second clip onwards the previous clip's video is still on the
   * page, so "a video exists" is true the instant the wait starts. Requiring
   * either a NEW playable video or an observed GENERATING -> done transition
   * stops the loop from racing through the remaining shots without generating
   * anything.
   */
  requireNewVideo?: boolean;
}

/**
 * Bounded polling on the real page state — the replacement for fixed sleeps.
 *
 * Returns as soon as Flow actually reaches one of `states`, fails fast on
 * `failStates` (or on a sign-in screen), and gives up at `timeoutMs` with the
 * last observation attached so the failure is diagnosable from the dashboard.
 */
export async function waitForFlowState(
  page: Page,
  options: WaitForFlowStateOptions
): Promise<FlowObservation> {
  const pollMs = Math.max(500, options.pollMs ?? 2000);
  const deadline = Date.now() + Math.max(1000, options.timeoutMs);
  const wanted = new Set<FlowState>(options.states);
  const failing = new Set<FlowState>(options.failStates ?? []);
  const failOnLogin = options.failOnLoginRequired ?? true;
  const seen: string[] = [];
  let observation = await observeFlow(page);
  const baselineVideos = observation.report.media.playableVideos;
  let sawGenerating = observation.classification.state === "GENERATING";

  for (;;) {
    const state = observation.classification.state;
    if (state === "GENERATING") sawGenerating = true;
    if (seen[seen.length - 1] !== state) {
      seen.push(state);
      options.log?.(`Flow state: ${state} — ${observation.classification.reason}`);
    }

    const freshResult =
      !options.requireNewVideo ||
      sawGenerating ||
      observation.report.media.playableVideos > baselineVideos;

    if (wanted.has(state) && freshResult) {
      if (options.screenshotName) await capture(page, options, options.screenshotName, observation);
      return observation;
    }
    if (failOnLogin && state === "LOGIN_REQUIRED" && !wanted.has("LOGIN_REQUIRED")) {
      await capture(page, options, FLOW_SCREENSHOTS.error, observation);
      throw loginRequired(observation, options.stepId);
    }
    if (failing.has(state)) {
      await capture(page, options, FLOW_SCREENSHOTS.error, observation);
      throw new AutomationError({
        errorCode: state === "ERROR" ? "FLOW_GENERATION_ERROR" : `FLOW_STATE_${state}`,
        message: `Flow entered "${state}" while waiting for ${options.states.join(" | ")}: ${observation.classification.reason}`,
        category: "TRANSIENT",
        retryable: true,
        stepId: options.stepId,
        details: {
          flowState: state,
          url: observation.report.url,
          errorText: observation.classification.errorText,
        },
      });
    }
    if (Date.now() >= deadline) {
      await capture(page, options, FLOW_SCREENSHOTS.error, observation);
      throw new AutomationError({
        errorCode: "FLOW_STATE_TIMEOUT",
        message:
          `Flow never reached ${options.states.join(" | ")} within ${options.timeoutMs}ms. ` +
          `Last observed state: ${state} (${observation.classification.reason}).` +
          (options.requireNewVideo ? ` No new clip appeared (started with ${baselineVideos} playable video(s)).` : ""),
        category: "TRANSIENT",
        retryable: true,
        stepId: options.stepId,
        details: {
          statesSeen: seen,
          lastState: state,
          baselineVideos,
          playableVideos: observation.report.media.playableVideos,
          url: observation.report.url,
          title: observation.report.title,
          discovered: summariseProbe(observation.report, 25),
        },
      });
    }

    await sleep(Math.min(pollMs, Math.max(250, deadline - Date.now())));
    observation = await observeFlow(page);
  }
}

export interface NavigateFlowOptions extends FlowDriverHooks {
  goal?: FlowState;
  maxSteps?: number;
  timeoutMs?: number;
  pollMs?: number;
  stepId?: string;
  /** How long to give Flow to open the app in a new tab after a click. */
  newTabGraceMs?: number;
}

/**
 * Drives Flow from whatever screen is actually on display to the goal state.
 *
 * Every round re-inspects the live page rather than assuming the previous
 * click worked, and every transition is screenshotted under a stable name so a
 * failed run can be read off the dashboard without reproducing it.
 */
export async function navigateFlow(
  session: BrowserSession,
  options: NavigateFlowOptions = {}
): Promise<{ observation: FlowObservation; history: string[] }> {
  const goal = options.goal ?? "GENERATION_UI";
  const maxSteps = options.maxSteps ?? 8;
  const pollMs = Math.max(500, options.pollMs ?? 1500);
  const deadline = Date.now() + Math.max(5000, options.timeoutMs ?? 120_000);
  // Reaching the app at all satisfies a GENERATION_UI goal: an in-flight
  // generation or a finished clip both prove we are past landing/auth.
  const inApp: FlowState[] = ["GENERATION_UI", "GENERATING", "CLIP_READY"];
  const satisfied = (state: FlowState) => state === goal || (goal === "GENERATION_UI" && inApp.includes(state));

  const history: string[] = [];
  let lastSignature = "";
  let stallCount = 0;

  for (let step = 0; step < maxSteps; step++) {
    let observation = await observeFlow(session.activePage);
    const { state, reason } = observation.classification;
    history.push(`${state}: ${reason}`);
    options.log?.(`Flow navigator [${step + 1}/${maxSteps}] ${state} — ${reason}`);

    if (step === 0) await capture(session.activePage, options, FLOW_SCREENSHOTS.landing, observation);

    if (satisfied(state)) {
      await capture(session.activePage, options, FLOW_SCREENSHOTS.generationUi, observation);
      return { observation, history };
    }

    if (state === "LOGIN_REQUIRED") {
      await capture(session.activePage, options, FLOW_SCREENSHOTS.error, observation);
      throw loginRequired(observation, options.stepId);
    }

    if (state === "ERROR") {
      await capture(session.activePage, options, FLOW_SCREENSHOTS.error, observation);
      throw new AutomationError({
        errorCode: "FLOW_ERROR_SCREEN",
        message: `Flow showed an error before the generation UI was reachable: ${observation.classification.reason}`,
        category: "TRANSIENT",
        retryable: true,
        stepId: options.stepId,
        details: { url: observation.report.url, errorText: observation.classification.errorText },
      });
    }

    if (state === "LOADING") {
      if (Date.now() >= deadline) throw unknownScreen(observation, options.stepId, "Flow never finished loading.");
      await sleep(pollMs);
      continue;
    }

    const action = observation.classification.primaryAction;
    if (!action) {
      await capture(session.activePage, options, FLOW_SCREENSHOTS.error, observation);
      throw unknownScreen(observation, options.stepId, `No control was found to advance from ${state}.`);
    }

    const signature = `${state}|${observation.report.url}|${action.cssPath}`;
    if (signature === lastSignature) {
      stallCount += 1;
      if (stallCount >= 2) {
        await capture(session.activePage, options, FLOW_SCREENSHOTS.error, observation);
        throw unknownScreen(
          observation,
          options.stepId,
          `Clicking "${action.name}" did not change the screen after ${stallCount + 1} attempts.`
        );
      }
    } else {
      stallCount = 0;
      lastSignature = signature;
    }

    if (state !== "LANDING" || step > 0) {
      await capture(
        session.activePage,
        options,
        state === "LANDING" ? FLOW_SCREENSHOTS.landing : FLOW_SCREENSHOTS.workspace,
        observation
      );
    }

    options.log?.(`Flow navigator clicking discovered control "${action.name}" (${action.cssPath})`);
    const tabsBefore = session.tabs.length;
    const page = session.activePage;
    const urlBefore = page.url();
    await page.locator(action.cssPath).first().click({ timeout: 15_000 });

    // Flow's landing CTA can open the app in a new tab; follow it if it does.
    // A same-tab navigation ends the grace period early so the common case
    // does not pay for the uncommon one.
    const newTabDeadline = Date.now() + (options.newTabGraceMs ?? 2500);
    while (session.tabs.length === tabsBefore && Date.now() < newTabDeadline) {
      if (session.activePage.url() !== urlBefore) break;
      await sleep(100);
    }
    if (session.tabs.length > tabsBefore) {
      session.switchTab(session.tabs.length - 1);
      options.log?.("Flow navigator followed a newly opened tab");
    }

    try {
      await session.activePage.waitForLoadState("domcontentloaded", { timeout: 20_000 });
    } catch {
      /* a client-side transition never fires a load event — the next probe settles it */
    }
    await sleep(pollMs);

    observation = await observeFlow(session.activePage);
    await capture(session.activePage, options, FLOW_SCREENSHOTS.afterCreate, observation);

    if (Date.now() >= deadline) {
      throw unknownScreen(observation, options.stepId, "Ran out of time advancing through Flow.");
    }
  }

  const final = await observeFlow(session.activePage);
  if (satisfied(final.classification.state)) {
    await capture(session.activePage, options, FLOW_SCREENSHOTS.generationUi, final);
    return { observation: final, history };
  }
  await capture(session.activePage, options, FLOW_SCREENSHOTS.error, final);
  throw unknownScreen(final, options.stepId, `Gave up after ${maxSteps} navigation steps.`);
}

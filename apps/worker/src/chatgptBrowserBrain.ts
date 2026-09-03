import type { Page } from "playwright";
import { AIRequest } from "@bos/database";
import { agentActionSchema, type AgentAction } from "@bos/shared";
import {
  captureAgentSnapshot,
  describeChanges,
  renderOutline,
  targetForElement,
  type BrowserSession,
  type PageProbeReport,
  type ProbedElement,
} from "@bos/browser";

const CHATGPT_COMPOSER = "#prompt-textarea:visible, textarea:visible, div[contenteditable='true'][role='textbox']:visible, div[contenteditable='true'][data-lexical-editor='true']:visible";

interface BrainOptions {
  onObservation?: (name: string, buffer: Buffer, meta?: Record<string, unknown>) => Promise<void> | void;
  log?: (message: string) => void;
}

interface BrainDecision {
  action: "click" | "type" | "clear" | "press" | "scroll" | "wait" | "select" | "download" | "navigate" | "screenshot" | "done" | "fail";
  elementId?: string;
  targetText?: string;
  text?: string;
  value?: string;
  key?: string;
  direction?: "up" | "down" | "top" | "bottom";
  seconds?: number;
  url?: string;
  reason?: string;
}

function compactMission(variables: Record<string, unknown>): string {
  const plan = (variables.flowPlan as { result?: unknown } | undefined)?.result ?? variables.flowPlan ?? variables.idea ?? variables.input;
  try {
    return JSON.stringify(plan, null, 2).slice(0, 11_000);
  } catch {
    return String(plan ?? "Complete the requested Google Flow video mission.").slice(0, 11_000);
  }
}

/**
 * The element ids the brain is shown ARE the refs stamped on the live DOM, so
 * "click e7" resolves to that exact node rather than to whatever currently
 * matches a description of it.
 */
function controlRows(report: PageProbeReport): Array<{ id: string; el: ProbedElement }> {
  return report.elements.slice(0, 100).map((el) => ({ id: el.ref, el }));
}

function observationText(report: PageProbeReport, notices: string[], changed: string): string {
  return [
    `URL: ${report.url}`,
    `TITLE: ${report.title}`,
    `MEDIA: videos=${report.media.videos}, playable=${report.media.playableVideos}, progressBars=${report.media.progressBars}`,
    `WHAT CHANGED SINCE YOUR LAST ACTION: ${changed}`,
    notices.length ? `NOTICES:\n${notices.map((n) => `! ${n}`).join("\n")}` : "NOTICES: (none)",
    "VISIBLE CONTROLS (act on these by id):",
    renderOutline(report, 100),
    "VISIBLE PAGE TEXT:",
    report.visibleText.slice(0, 4500),
  ].join("\n");
}

function protocolPrompt(
  goal: string,
  variables: Record<string, unknown>,
  previousActions: AgentAction[],
  report: PageProbeReport,
  notices: string[],
  changed: string,
  includeMission: boolean
): string {
  const lastError = variables.browserAgentLastError ? String(variables.browserAgentLastError) : "none";
  const recent = previousActions.slice(-12).map((action, i) => `${i + 1}. ${action.tool} — ${action.reason}`).join("\n") || "none";
  return [
    includeMission ? "You are the browser brain controlling an already-open Google Flow tab." : "Continue the SAME Google Flow video mission from our previous turns.",
    "Choose exactly ONE next browser action from the current observation.",
    "Do not merely give instructions. Inspect the CURRENT observation every turn and act through Google Flow.",
    "Button labels/layouts can change; choose the equivalent visible control instead of assuming old selectors.",
    "Do not assume a textbox, New Project button, Agent button, editor, timeline, or export control exists until the observation shows it.",
    "Generate every required clip in order. Wait for actual completion evidence before continuing. Preserve continuity. Continue through editing/export/download when the mission requires it.",
    "Only return DONE when the requested mission is genuinely complete, not merely because a prompt was submitted or one clip exists.",
    "If Google authentication/MFA is required, return FAIL and explain manual login is required.",
    "Do not use another video-generation website.",
    "",
    `GOAL: ${goal}`,
    ...(includeMission ? ["", "VIDEO MISSION:", compactMission(variables)] : []),
    "",
    "CURRENT GOOGLE FLOW OBSERVATION:",
    observationText(report, notices, changed),
    "",
    "RECENT ACTIONS:",
    recent,
    "",
    `LAST ACTION ERROR: ${lastError}`,
    "",
    "Return STRICT JSON ONLY (no markdown). Use exactly one of these shapes:",
    '{"action":"click","elementId":"e3","reason":"..."}',
    '{"action":"click","targetText":"+ New project","reason":"..."}',
    '{"action":"type","elementId":"e7","text":"text to enter","reason":"..."}',
    '{"action":"clear","elementId":"e7","reason":"..."}',
    '{"action":"press","elementId":"e7","key":"Enter","reason":"..."}',
    '{"action":"select","elementId":"e4","value":"9:16","reason":"..."}',
    '{"action":"scroll","direction":"down","reason":"..."}',
    '{"action":"wait","seconds":8,"reason":"generation is still running"}',
    '{"action":"download","elementId":"e12","reason":"..."}',
    '{"action":"navigate","url":"https://labs.google/fx/tools/flow","reason":"..."}',
    '{"action":"screenshot","reason":"need a fresh visual checkpoint"}',
    '{"action":"done","reason":"mission completion evidence"}',
    '{"action":"fail","reason":"manual login or unrecoverable blocker"}',
    "",
    "ALWAYS prefer elementId — the ids in the observation are handles on the real elements, so they cannot resolve to the wrong control. Use targetText only when an obvious clickable label appears in VISIBLE PAGE TEXT but in no listed control.",
    "Only use ids from the CURRENT observation. If WHAT CHANGED says nothing changed, your last action did not work: do not repeat it, look for a different control.",
    "For typing, use the exact shot prompt/voiceover/requirements from the mission already provided; do not invent a different project.",
  ].join("\n");
}

async function waitForComposer(page: Page): Promise<void> {
  await page.locator(CHATGPT_COMPOSER).first().waitFor({ state: "visible", timeout: 35_000 });
}

/**
 * The brain tab went away mid-question — the site closed it, the renderer
 * crashed, a tab-management action took it. Kept distinct from a genuine
 * ChatGPT failure because the cure is different: reopen it and ask again.
 */
class BrainTabClosed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrainTabClosed";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isClosedPageError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /has been closed|target closed|page closed|browser closed|target crashed/i.test(message);
}

async function askChatGpt(page: Page, prompt: string): Promise<string> {
  try {
    return await converseWithChatGpt(page, prompt);
  } catch (err) {
    if (err instanceof BrainTabClosed) throw err;
    if (isClosedPageError(err)) {
      throw new BrainTabClosed(`The ChatGPT brain tab closed while it was answering: ${(err as Error).message}`);
    }
    throw err;
  }
}

async function converseWithChatGpt(page: Page, prompt: string): Promise<string> {
  await waitForComposer(page);
  const composer = page.locator(CHATGPT_COMPOSER).first();
  const assistant = page.locator('[data-message-author-role="assistant"]');
  const before = await assistant.count();
  await composer.fill(prompt);
  await composer.press("Enter");

  const deadline = Date.now() + 180_000;
  let last = "";
  let stable = 0;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new BrainTabClosed("The ChatGPT brain tab closed while it was answering.");
    const count = await assistant.count();
    if (count > before) {
      const text = ((await assistant.nth(count - 1).innerText().catch(() => "")) || "").trim();
      if (text && text === last && text.length > 20) stable += 1;
      else stable = 0;
      last = text || last;
      if (stable >= 2) return last;
    }
    // A page-owned wait dies with the page, reporting itself as a bare
    // "page.waitForTimeout: Target page ... has been closed". A plain timer
    // outlives the tab, so the loop reaches the isClosed() check above and
    // names what actually happened.
    await sleep(1200);
  }
  if (last) return last;
  throw new Error("ChatGPT browser brain did not return a response within 180 seconds.");
}

function parseDecision(raw: string): BrainDecision {
  const cleaned = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Browser brain did not return JSON: ${raw.slice(0, 600)}`);
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as BrainDecision;
  if (!parsed.action) throw new Error(`Browser brain JSON has no action: ${raw.slice(0, 600)}`);
  return parsed;
}

function targetFor(
  decision: BrainDecision,
  rows: Array<{ id: string; el: ProbedElement }>,
  all: ProbedElement[]
): AgentAction["target"] | undefined {
  if (decision.elementId) {
    const row = rows.find((candidate) => candidate.id === decision.elementId);
    if (!row) {
      throw new Error(
        `Browser brain selected element "${decision.elementId}", which is not in the current observation. ` +
          `Available ids: ${rows.slice(0, 25).map((candidate) => candidate.id).join(", ")}.`
      );
    }
    return targetForElement(row.el, all);
  }
  if (decision.targetText) return { text: decision.targetText, preferSemantic: true };
  return undefined;
}

function toAgentAction(
  decision: BrainDecision,
  rows: Array<{ id: string; el: ProbedElement }>,
  all: ProbedElement[]
): AgentAction {
  const reason = String(decision.reason || `ChatGPT browser brain chose ${decision.action}`);
  const target = targetFor(decision, rows, all);
  let action: AgentAction;
  switch (decision.action) {
    case "click": action = { tool: "browser_click", target, reason }; break;
    case "type": action = { tool: "browser_type", target, value: decision.text ?? decision.value ?? "", reason }; break;
    case "clear": action = { tool: "browser_clear", target, reason }; break;
    case "press": action = { tool: "browser_press", target, key: decision.key || "Enter", reason }; break;
    case "select": action = { tool: "browser_select", target, value: decision.value ?? "", reason }; break;
    case "scroll": action = { tool: "browser_scroll", value: decision.direction || "down", reason }; break;
    case "wait": action = { tool: "browser_wait", value: String(Math.max(1, Math.min(30, decision.seconds ?? 5)) * 1000), reason }; break;
    case "download": action = { tool: "browser_download", target, reason }; break;
    case "navigate": action = { tool: "browser_navigate", url: decision.url || "https://labs.google/fx/tools/flow", reason }; break;
    case "screenshot": action = { tool: "browser_screenshot", reason }; break;
    case "done": action = { tool: "task_complete", reason }; break;
    case "fail": action = { tool: "task_fail", reason }; break;
    default: throw new Error(`Unsupported browser-brain action ${(decision as BrainDecision).action}`);
  }
  return agentActionSchema.parse(action);
}

export function buildChatGptWebDecisionHook(taskId: string, session: BrowserSession, options: BrainOptions = {}) {
  let brainPage: Page | null = null;
  let observationNumber = 0;
  let brainInitialized = false;
  let previousReport: PageProbeReport | undefined;

  function focusTab(page: Page, label: string): void {
    const index = session.tabs.indexOf(page);
    if (index < 0) throw new Error(`${label} tab disappeared.`);
    session.switchTab(index);
  }

  async function ensureBrainTab(returnTo: Page): Promise<Page> {
    if (brainPage && !brainPage.isClosed()) return brainPage;
    brainPage = await session.newTab("https://chatgpt.com/");
    brainInitialized = false;
    await waitForComposer(brainPage);
    const returnIndex = session.tabs.indexOf(returnTo);
    if (returnIndex >= 0) session.switchTab(returnIndex);
    return brainPage;
  }

  return async (goal: string, variables: Record<string, unknown>, previousActions: AgentAction[]): Promise<AgentAction> => {
    const flowPage = session.activePage;
    // Settle first: an observation taken while Flow is still re-rendering
    // describes a page that no longer exists by the time the brain answers.
    const snapshot = await captureAgentSnapshot(flowPage, { maxElements: 120, maxTextLength: 6000 });
    const report = snapshot.report;
    const notices = snapshot.page.notices ?? [];
    const changed = describeChanges(previousReport, report);
    previousReport = report;
    const rows = controlRows(report);
    observationNumber += 1;
    variables.browserAgentStep = observationNumber;
    variables.browserAgentObservation = {
      url: report.url,
      title: report.title,
      media: report.media,
      changed,
      notices,
      controls: rows.slice(0, 40).map(({ id, el }) => ({ id, role: el.role, name: el.name || el.text, editable: el.editable, disabled: el.disabled })),
    };

    if (options.onObservation) {
      const buffer = await flowPage.screenshot({ fullPage: false });
      await options.onObservation(`agent_observe_${String(observationNumber).padStart(3, "0")}`, buffer, {
        url: report.url,
        title: report.title,
        controls: rows.length,
        media: report.media,
      });
    }

    let chat = await ensureBrainTab(flowPage);
    focusTab(chat, "ChatGPT browser brain");
    const started = Date.now();
    try {
      // A reopened tab is a brand-new conversation holding none of the prior
      // turns, so every retry restates the mission.
      const prompt = protocolPrompt(goal, variables, previousActions, report, notices, changed, !brainInitialized);
      const restated = protocolPrompt(goal, variables, previousActions, report, notices, changed, true);

      // Reopening the brain tab costs one round trip. Letting the closure
      // escape costs the whole mission: a raw Playwright error out of this
      // hook is unclassified, and the engine files unclassified decision
      // failures as PERMANENT.
      const ask = async (text: string): Promise<string> => {
        try {
          return await askChatGpt(chat, text);
        } catch (err) {
          if (!(err instanceof BrainTabClosed)) throw err;
          options.log?.(`${err.message} Reopening ChatGPT and restating the mission.`);
          brainPage = null;
          chat = await ensureBrainTab(flowPage);
          focusTab(chat, "ChatGPT browser brain");
          return askChatGpt(chat, restated);
        }
      };

      let raw = await ask(prompt);
      let decision: BrainDecision;
      try {
        decision = parseDecision(raw);
      } catch (firstParseError) {
        options.log?.(`Browser brain returned invalid JSON; requesting one correction: ${(firstParseError as Error).message}`);
        raw = await ask("Your previous reply was not valid strict JSON for the browser-action protocol. Return ONLY one valid JSON action now, with no markdown or explanation.");
        decision = parseDecision(raw);
      }
      brainInitialized = true;
      const action = toAgentAction(decision, rows, report.elements);
      await AIRequest.create({
        taskId,
        provider: "chatgpt-web",
        modelName: "chatgpt-web",
        prompt: `browser-agent observation=${observationNumber} url=${report.url}`,
        response: raw.slice(0, 12_000),
        action,
        latencyMs: Date.now() - started,
      });
      options.log?.(`Browser brain #${observationNumber}: ${action.tool} — ${action.reason}`);
      const flowIndex = session.tabs.indexOf(flowPage);
      if (flowIndex < 0) throw new Error("Google Flow tab disappeared while ChatGPT was deciding the next action.");
      session.switchTab(flowIndex);
      return action;
    } catch (err) {
      await AIRequest.create({
        taskId,
        provider: "chatgpt-web",
        modelName: "chatgpt-web",
        prompt: `browser-agent observation=${observationNumber} url=${report.url}`,
        error: (err as Error).message,
        latencyMs: Date.now() - started,
      });
      const flowIndex = session.tabs.indexOf(flowPage);
      if (flowIndex >= 0) session.switchTab(flowIndex);
      throw err;
    }
  };
}

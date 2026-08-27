import type { Page } from "playwright";
import { AIRequest } from "@bos/database";
import { agentActionSchema, type AgentAction } from "@bos/shared";
import { probePage, type BrowserSession, type PageProbeReport, type ProbedElement } from "@bos/browser";

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

function controlRows(report: PageProbeReport): Array<{ id: string; el: ProbedElement }> {
  return report.elements.slice(0, 100).map((el, index) => ({ id: `e${index + 1}`, el }));
}

function observationText(report: PageProbeReport, rows: Array<{ id: string; el: ProbedElement }>): string {
  const controls = rows.map(({ id, el }) => {
    const flags = [el.editable ? "editable" : "", el.disabled ? "disabled" : "", el.inViewport ? "in-view" : "off-view"].filter(Boolean).join(",");
    return `${id} | role=${el.role || "generic"} | tag=${el.tag} | name=${JSON.stringify(el.name || el.text || "")} | ${flags || "normal"}`;
  });
  return [
    `URL: ${report.url}`,
    `TITLE: ${report.title}`,
    `MEDIA: videos=${report.media.videos}, playable=${report.media.playableVideos}, progressBars=${report.media.progressBars}`,
    "VISIBLE CONTROLS:",
    controls.join("\n") || "(none discovered)",
    "VISIBLE PAGE TEXT:",
    report.visibleText.slice(0, 4500),
  ].join("\n");
}

function protocolPrompt(goal: string, variables: Record<string, unknown>, previousActions: AgentAction[], report: PageProbeReport, rows: Array<{ id: string; el: ProbedElement }>): string {
  const lastError = variables.browserAgentLastError ? String(variables.browserAgentLastError) : "none";
  const recent = previousActions.slice(-12).map((action, i) => `${i + 1}. ${action.tool} — ${action.reason}`).join("\n") || "none";
  return [
    "You are the browser brain controlling an already-open Google Flow tab.",
    "Your job is to complete the video mission through the visible Google Flow UI, one browser action at a time.",
    "Do not merely give instructions. Choose the NEXT browser action.",
    "Do not use another video-generation website. Stay in Google Flow unless the requested action is a harmless wait/scroll.",
    "Inspect the CURRENT observation every turn. Button labels and layouts can change; choose the equivalent visible control.",
    "Do not assume a textbox, New Project button, Agent button, editor, timeline, or export control exists until the observation shows it.",
    "Generate every required clip in order. Wait for actual completion signals before proceeding. Preserve continuity. Continue through editing/export/download when the mission requires it.",
    "Only return DONE when the requested mission is genuinely complete, not merely because a prompt was submitted.",
    "If Google authentication/MFA is required, return FAIL and explain that manual login is required.",
    "",
    `GOAL: ${goal}`,
    "",
    "VIDEO MISSION:",
    compactMission(variables),
    "",
    "CURRENT GOOGLE FLOW OBSERVATION:",
    observationText(report, rows),
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
    "Prefer elementId when the control is listed. If an obvious clickable label appears only in VISIBLE PAGE TEXT, targetText may be used.",
    "For typing, copy the exact shot prompt/voiceover/requirements from VIDEO MISSION as needed; do not invent a different project.",
  ].join("\n");
}

async function waitForComposer(page: Page): Promise<void> {
  await page.locator(CHATGPT_COMPOSER).first().waitFor({ state: "visible", timeout: 35_000 });
}

async function askChatGpt(page: Page, prompt: string): Promise<string> {
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
    const count = await assistant.count();
    if (count > before) {
      const text = ((await assistant.nth(count - 1).innerText().catch(() => "")) || "").trim();
      if (text && text === last && text.length > 20) stable += 1;
      else stable = 0;
      last = text || last;
      if (stable >= 2) return last;
    }
    await page.waitForTimeout(1200);
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

function targetFor(decision: BrainDecision, rows: Array<{ id: string; el: ProbedElement }>): AgentAction["target"] | undefined {
  if (decision.elementId) {
    const row = rows.find((candidate) => candidate.id === decision.elementId);
    if (!row) throw new Error(`Browser brain selected stale/unknown element ${decision.elementId}`);
    return { css: row.el.cssPath };
  }
  if (decision.targetText) return { text: decision.targetText };
  return undefined;
}

function toAgentAction(decision: BrainDecision, rows: Array<{ id: string; el: ProbedElement }>): AgentAction {
  const reason = String(decision.reason || `ChatGPT browser brain chose ${decision.action}`);
  const target = targetFor(decision, rows);
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

  async function ensureBrainTab(returnTo: Page): Promise<Page> {
    if (brainPage && !brainPage.isClosed()) return brainPage;
    brainPage = await session.newTab("https://chatgpt.com/");
    await waitForComposer(brainPage);
    const returnIndex = session.tabs.indexOf(returnTo);
    if (returnIndex >= 0) session.switchTab(returnIndex);
    return brainPage;
  }

  return async (goal: string, variables: Record<string, unknown>, previousActions: AgentAction[]): Promise<AgentAction> => {
    const flowPage = session.activePage;
    const report = await probePage(flowPage, { maxElements: 120, maxTextLength: 6000 });
    const rows = controlRows(report);
    observationNumber += 1;
    variables.browserAgentStep = observationNumber;
    variables.browserAgentObservation = {
      url: report.url,
      title: report.title,
      media: report.media,
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

    const chat = await ensureBrainTab(flowPage);
    const brainIndex = session.tabs.indexOf(chat);
    if (brainIndex < 0) throw new Error("ChatGPT browser brain tab disappeared.");
    session.switchTab(brainIndex);
    const prompt = protocolPrompt(goal, variables, previousActions, report, rows);
    const started = Date.now();
    try {
      const raw = await askChatGpt(chat, prompt);
      const decision = parseDecision(raw);
      const action = toAgentAction(decision, rows);
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

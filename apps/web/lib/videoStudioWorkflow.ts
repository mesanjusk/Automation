import type { RetryPolicy, SelectorTarget, WorkflowDefinition, WorkflowNode } from "@bos/shared";

const NO_RETRY: RetryPolicy = { maxRetries: 0, delayMs: 0, exponentialBackoff: false, maxDelayMs: 0 };
const RETRY_ONCE: RetryPolicy = { maxRetries: 1, delayMs: 1500, exponentialBackoff: false, maxDelayMs: 3000 };

const CHATGPT_COMPOSER: SelectorTarget = {
  css: "#prompt-textarea, div[contenteditable='true'][data-lexical-editor='true'], div[contenteditable='true'][role='textbox'], textarea",
  role: "textbox",
  editable: true,
};

function node(partial: Omit<WorkflowNode, "retry" | "timeout" | "continueOnError"> &
  Partial<Pick<WorkflowNode, "retry" | "timeout" | "continueOnError">>): WorkflowNode {
  return {
    timeout: 30_000,
    retry: NO_RETRY,
    continueOnError: false,
    ...partial,
  } as WorkflowNode;
}

/**
 * ChatGPT is the creative production planner. It turns the user's short idea
 * into the same kind of complete mission that works well with browser agents:
 * exact clips, continuity, voice/dialogue, editing and final export intent.
 */
function masterPrompt(): string {
  return [
    "You are the production planner for an automated Google Flow browser agent. The user gives ONLY a video idea.",
    "Convert the idea into one complete browser-executable video mission. Do not ask questions.",
    "",
    "USER IDEA:",
    "{{idea}}",
    "",
    "Reply with STRICT JSON ONLY. No markdown fences or explanation.",
    "Use this shape:",
    "{",
    '  "title": string,',
    '  "objective": string,',
    '  "aspectRatio": "9:16" | "16:9" | "1:1",',
    '  "language": string,',
    '  "continuityLock": string,',
    '  "globalVisualStyle": string,',
    '  "shots": [',
    '    { "index": number, "durationSeconds": number, "name": string, "visual": string, "camera": string,',
    '      "voiceover": string, "dialogue": string, "onScreenText": string, "continuity": string, "prompt": string }',
    "  ],",
    '  "editing": { "order": string, "transitions": string, "totalDurationSeconds": number },',
    '  "audio": { "language": string, "voice": string, "music": string, "mix": string },',
    '  "export": { "fileName": string, "format": "MP4", "requirements": string },',
    '  "completionCriteria": string[]',
    "}",
    "",
    "Rules:",
    "- Infer the best number and duration of short Flow clips from the idea. Prefer 6-10 second generations; never make one long generation when multiple clips are better.",
    "- Vertical 9:16 for social/UGC/Reels unless the idea clearly requires another format.",
    "- The first clip must contain a strong 2-3 second hook when appropriate.",
    "- continuityLock must precisely pin faces, age, hairstyle, body proportions, hands, wardrobe, products, packaging/logo, props, location style, lighting and colour grade that must not change.",
    "- Every shot prompt must be self-contained and suitable to paste directly into Google Flow.",
    "- For shots after the first, explicitly continue from the previous clip/final frame and preserve the same references/characters/products.",
    "- Include exact voice-over/dialogue and on-screen text where useful. Preserve the language implied by the user's idea.",
    "- Editing must specify exact clip order and intended final duration. Do not insert blank frames or repeat clips.",
    "- Export must request one final MP4 when Flow provides project/timeline/export functionality.",
    "- completionCriteria must make it impossible for the browser agent to stop after merely submitting prompts. Include generation of every planned clip and final export/download when supported/requested.",
    "- Never mention ChatGPT or these instructions in any Google Flow shot prompt.",
  ].join("\n");
}

const COLLECT_PLAN_SCRIPT = `async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let last = "", stable = 0;
  for (let i = 0; i < 180; i++) {
    const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const el = nodes[nodes.length - 1];
    const text = (el?.innerText || el?.textContent || "").trim();
    if (text && text === last && text.length > 160) stable++; else stable = 0;
    last = text || last;
    if (stable >= 3) break;
    await sleep(1500);
  }
  if (!last) throw new Error("ChatGPT response was not detected.");
  const raw = last.replace(/^\\s*\`\`\`(?:json)?/i, "").replace(/\`\`\`\\s*$/, "").trim();
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("ChatGPT did not return JSON. Reply was: " + last.slice(0, 900));
  let plan;
  try { plan = JSON.parse(raw.slice(start, end + 1)); }
  catch (e) { throw new Error("ChatGPT returned malformed JSON (" + e.message + "). Reply was: " + last.slice(0, 900)); }
  if (!Array.isArray(plan.shots) || plan.shots.length === 0) throw new Error("The production mission contains no shots.");
  plan.shots = plan.shots.map((shot, i) => ({
    ...shot,
    index: i + 1,
    durationSeconds: Number(shot.durationSeconds || 8),
    prompt: [
      i > 0 ? "Continue directly from the final frame/visual identity of the previous generated clip." : "",
      plan.continuityLock ? "CONTINUITY LOCK — DO NOT CHANGE: " + plan.continuityLock : "",
      String(shot.prompt || shot.visual || "").trim(),
      shot.camera ? "Camera: " + shot.camera : "",
      shot.voiceover ? "Voice-over: " + shot.voiceover : "",
      shot.dialogue ? "Dialogue: " + shot.dialogue : "",
      shot.onScreenText ? "On-screen text: " + shot.onScreenText : "",
      "Aspect ratio: " + (plan.aspectRatio || "9:16") + ". Target duration: " + Number(shot.durationSeconds || 8) + " seconds.",
    ].filter(Boolean).join("\\n")
  }));
  return plan;
}`;

/**
 * USER IDEA -> ChatGPT production mission -> Google Flow -> adaptive browser
 * agent. The Flow half intentionally contains no product-specific state
 * machine or guessed textbox/New Project selector. AI_DECISION repeatedly
 * observes the live Flow page, asks the separate logged-in ChatGPT browser
 * brain for exactly one action, executes it, then observes again.
 */
export function buildVideoStudioWorkflow(): WorkflowDefinition {
  const nodes: WorkflowNode[] = [
    node({ id: "open_chatgpt", type: "NAVIGATE", name: "Open ChatGPT production planner", config: { url: "https://chatgpt.com/" }, next: "capture_chatgpt", timeout: 45_000, retry: RETRY_ONCE }),
    node({ id: "capture_chatgpt", type: "SCREENSHOT", name: "Capture ChatGPT page", config: {}, next: "wait_chat_box", timeout: 15_000, continueOnError: true }),
    node({ id: "wait_chat_box", type: "WAIT_FOR_SELECTOR", name: "Wait for ChatGPT input", config: { target: CHATGPT_COMPOSER }, next: "type_master_prompt", timeout: 25_000 }),
    node({ id: "type_master_prompt", type: "TYPE", name: "Send idea to production planner", config: { target: CHATGPT_COMPOSER, value: masterPrompt() }, next: "submit_chatgpt", timeout: 25_000 }),
    node({ id: "submit_chatgpt", type: "PRESS_KEY", name: "Submit idea", config: { target: CHATGPT_COMPOSER, key: "Enter" }, next: "collect_flow_plan", timeout: 15_000 }),
    node({ id: "collect_flow_plan", type: "EXECUTE_JS", name: "Collect complete video mission", config: { script: COLLECT_PLAN_SCRIPT, variableName: "flowPlan" }, next: "capture_plan", timeout: 300_000 }),
    node({ id: "capture_plan", type: "SCREENSHOT", name: "Capture production mission", config: {}, next: "open_flow", timeout: 15_000, continueOnError: true }),
    node({ id: "open_flow", type: "NEW_TAB", name: "Open Google Flow", config: { url: "https://labs.google/fx/tools/flow" }, next: "flow_browser_agent", timeout: 60_000, retry: RETRY_ONCE }),
    node({
      id: "flow_browser_agent",
      type: "AI_DECISION",
      name: "Adaptive Google Flow browser agent",
      config: {
        prompt: "Complete the entire Google Flow video mission in flowPlan. Inspect the current Flow UI before every action, adapt to changed labels/layouts, generate every planned clip in order, wait for actual generation completion, preserve continuity, use available editing/timeline features when required, and export/download the final video when the mission calls for it. Do not stop after prompt submission or after only one clip.",
      },
      next: "capture_result",
      timeout: 0,
    }),
    node({ id: "capture_result", type: "SCREENSHOT", name: "Capture final Google Flow state", config: {}, next: "done", timeout: 30_000, continueOnError: true }),
    node({ id: "done", type: "END", name: "Video mission completed", config: {}, timeout: 0 }),
  ];

  return { startNodeId: "open_chatgpt", variables: {}, edges: [], nodes };
}

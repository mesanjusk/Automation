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

/**
 * Reads the planner's latest reply — and nothing else.
 *
 * The previous version waited on a heuristic ("the text has not changed for
 * 4.5 seconds"), which a streamed reply satisfies every time it pauses to
 * think. It then parsed and reshaped the plan inside the page, so one stray
 * character in a four-thousand-character answer threw from `page.evaluate` and
 * ended the whole run as PERMANENT.
 *
 * Now it only waits and returns raw text. Waiting keys off the signals the app
 * itself gives — the stop-streaming button that is present for exactly as long
 * as the model is writing, and the copy-message action that appears only once
 * a turn is finished — with text stability kept as a backstop for a UI that
 * offers neither. Parsing happens in PARSE_JSON, where a bad reply is a branch
 * rather than a fatal error.
 */
const COLLECT_PLAN_SCRIPT = `async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const STREAMING = '[data-testid="stop-button"], button[aria-label*="Stop"], .result-streaming';
  const FINISHED = '[data-testid="copy-turn-action-button"], [data-testid="good-response-turn-action-button"]';
  const lastTurn = () => {
    const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    return nodes[nodes.length - 1] || null;
  };
  const textOf = (el) => ((el && (el.innerText || el.textContent)) || "").trim();

  let text = "";
  let previous = "";
  let stableFor = 0;
  let sawStreaming = false;
  let settledAt = 0;
  const started = Date.now();

  // 10 minutes: a full production plan is long, and a slow answer is not a
  // broken one. The bound exists so a dead tab cannot hang the run forever.
  while (Date.now() - started < 600000) {
    const streaming = document.querySelector(STREAMING) !== null;
    if (streaming) { sawStreaming = true; settledAt = 0; }
    text = textOf(lastTurn());

    if (!streaming && text) {
      const turn = lastTurn();
      const complete = turn ? turn.closest('article, [data-testid^="conversation-turn"]') : null;
      const finished = complete ? complete.querySelector(FINISHED) !== null : false;
      stableFor = text === previous ? stableFor + 1 : 0;
      if (!settledAt) settledAt = Date.now();

      // Finished when the app says so, or — for a UI that exposes neither
      // signal — when nothing has changed for six seconds AND we either
      // watched it stream or have waited long enough that we cannot have
      // caught it mid-answer.
      if (finished && stableFor >= 1) break;
      if (stableFor >= 4 && (sawStreaming || Date.now() - started > 15000)) break;
    } else {
      stableFor = 0;
    }
    previous = text;
    await sleep(1500);
  }

  if (!text) throw new Error("ChatGPT did not produce a reply within 10 minutes.");
  return {
    text,
    length: text.length,
    watchedStreaming: sawStreaming,
    waitedMs: Date.now() - started,
    settledMs: settledAt ? Date.now() - settledAt : 0,
  };
}`;

/**
 * MANUAL SIGN-IN -> USER IDEA -> ChatGPT production mission -> Google Flow ->
 * adaptive browser agent.
 *
 * The run opens both sites and then waits for a person to sign in to each,
 * because that is the one part that cannot be automated and should not be:
 * no password is typed for you and no CAPTCHA or 2FA prompt is worked around.
 * Everything after the gate reuses that same signed-in window.
 *
 * The Flow half intentionally contains no product-specific state machine or
 * guessed textbox/New Project selector. AI_DECISION repeatedly observes the
 * live Flow page, asks the separate logged-in ChatGPT browser brain for
 * exactly one action, executes it, then observes again.
 */
export function buildVideoStudioWorkflow(): WorkflowDefinition {
  const nodes: WorkflowNode[] = [
    // Both sites open first, then the run stops and waits for a person to sign
    // in to each one. Signing in is deliberately not automated: no password is
    // ever typed for you, and no CAPTCHA or 2FA prompt is ever worked around.
    // The wait happens inside the run so the same window, tabs and cookies
    // carry straight into the steps below.
    node({
      id: "manual_sign_in",
      type: "WAIT_FOR_LOGIN",
      name: "Sign in to ChatGPT and Google Flow",
      config: {
        urls: ["https://chatgpt.com/", "https://labs.google/fx/tools/flow"],
        message: [
          "Chrome is open with two tabs: ChatGPT (the production planner) and Google Flow (where the clips get made).",
          "Sign in to BOTH, leave both tabs open, then come back here.",
        ].join("\n"),
      },
      next: "capture_chatgpt",
      timeout: 120_000,
    }),
    node({ id: "capture_chatgpt", type: "SCREENSHOT", name: "Capture ChatGPT page", config: {}, next: "wait_chat_box", timeout: 15_000, continueOnError: true }),
    node({ id: "wait_chat_box", type: "WAIT_FOR_SELECTOR", name: "Wait for ChatGPT input", config: { target: CHATGPT_COMPOSER }, next: "type_master_prompt", timeout: 25_000 }),
    node({ id: "type_master_prompt", type: "TYPE", name: "Send idea to production planner", config: { target: CHATGPT_COMPOSER, value: masterPrompt() }, next: "submit_chatgpt", timeout: 25_000 }),
    node({ id: "submit_chatgpt", type: "PRESS_KEY", name: "Submit idea", config: { target: CHATGPT_COMPOSER, key: "Enter" }, next: "collect_plan_reply", timeout: 15_000 }),

    // Read, then parse, as two separate steps. The read cannot fail on the
    // shape of the answer and the parse cannot fail on the speed of it, so
    // each failure names its own cause and can be recovered from differently.
    node({ id: "collect_plan_reply", type: "EXECUTE_JS", name: "Wait for the complete production mission", config: { script: COLLECT_PLAN_SCRIPT, variableName: "planReply" }, next: "parse_plan", timeout: 660_000 }),
    node({
      id: "parse_plan",
      type: "PARSE_JSON",
      name: "Parse the production mission",
      config: { sourceVariable: "planReply.result.text", variableName: "flowPlan", require: ["shots"] },
      next: "plan_ready",
      timeout: 15_000,
      // Not fatal: an unusable reply gets one chance to be corrected below.
      continueOnError: true,
    }),
    node({
      id: "plan_ready",
      type: "CONDITION",
      name: "Is the production mission usable?",
      config: { condition: { left: "flowPlan", operator: "exists" }, trueNodeId: "capture_plan", falseNodeId: "request_valid_json" },
      timeout: 0,
    }),

    // The planner is still sitting in a live conversation, so the cheapest fix
    // for a malformed answer is to tell it what was wrong and read the next
    // one — which is what a person would do, and what the browser agent
    // already does for its own decisions.
    node({
      id: "request_valid_json",
      type: "TYPE",
      name: "Ask the planner to resend valid JSON",
      config: {
        target: CHATGPT_COMPOSER,
        value: [
          "Your previous reply could not be parsed as JSON: {{flowPlanError}}",
          "",
          "Resend the SAME production mission as one strict JSON object and nothing else.",
          "No markdown fences, no commentary, no trailing commas.",
          'Every double quote inside a string value must be escaped as \\" — write 6-inch rather than 6".',
          "Do not change the creative content; only fix the JSON.",
        ].join("\n"),
      },
      next: "submit_valid_json",
      timeout: 25_000,
    }),
    node({ id: "submit_valid_json", type: "PRESS_KEY", name: "Submit the correction request", config: { target: CHATGPT_COMPOSER, key: "Enter" }, next: "collect_plan_retry", timeout: 15_000 }),
    node({ id: "collect_plan_retry", type: "EXECUTE_JS", name: "Wait for the corrected mission", config: { script: COLLECT_PLAN_SCRIPT, variableName: "planReply" }, next: "parse_plan_retry", timeout: 660_000 }),
    node({
      id: "parse_plan_retry",
      type: "PARSE_JSON",
      name: "Parse the corrected mission",
      config: { sourceVariable: "planReply.result.text", variableName: "flowPlan", require: ["shots"] },
      next: "plan_ready_retry",
      timeout: 15_000,
      continueOnError: true,
    }),
    node({
      id: "plan_ready_retry",
      type: "CONDITION",
      name: "Is the corrected mission usable?",
      config: { condition: { left: "flowPlan", operator: "exists" }, trueNodeId: "capture_plan", falseNodeId: "plan_unusable" },
      timeout: 0,
    }),
    node({
      id: "plan_unusable",
      type: "FAIL",
      name: "Production mission could not be read",
      config: {
        errorCode: "PLAN_JSON_UNUSABLE",
        errorMessage: "The production planner did not return usable JSON, even after being asked to correct it. Last parse failure: {{flowPlanError}}",
        // Retryable on purpose: this is one bad generation, not a broken
        // workflow, and the same run started again usually succeeds.
        category: "TRANSIENT",
        retryable: true,
      },
      timeout: 0,
    }),

    node({ id: "capture_plan", type: "SCREENSHOT", name: "Capture production mission", config: {}, next: "open_flow", timeout: 15_000, continueOnError: true }),
    // Flow is already open and signed in from the gate above — switching to
    // that tab keeps the session, rather than opening a second, signed-out one.
    node({ id: "open_flow", type: "SWITCH_TAB", name: "Switch to the signed-in Google Flow tab", config: { tabIndex: 1 }, next: "flow_browser_agent", timeout: 15_000 }),
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

  return { startNodeId: "manual_sign_in", variables: {}, edges: [], nodes };
}

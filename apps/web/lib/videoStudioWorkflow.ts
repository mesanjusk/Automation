import type { RetryPolicy, SelectorTarget, WorkflowDefinition, WorkflowNode } from "@bos/shared";

const NO_RETRY: RetryPolicy = { maxRetries: 0, delayMs: 0, exponentialBackoff: false, maxDelayMs: 0 };
const RETRY_ONCE: RetryPolicy = { maxRetries: 1, delayMs: 1500, exponentialBackoff: false, maxDelayMs: 3000 };
const RETRY_CLIP: RetryPolicy = { maxRetries: 1, delayMs: 5000, exponentialBackoff: false, maxDelayMs: 10_000 };

const CHATGPT_COMPOSER: SelectorTarget = {
  css: "#prompt-textarea, div[contenteditable='true'][data-lexical-editor='true'], div[contenteditable='true'][role='textbox'], textarea",
  role: "textbox",
  editable: true,
};

/**
 * Flow's composer is located from the *live page* at run time (PROBE_PAGE
 * discovers it and publishes its real selector as flowUi.composer.cssPath).
 * The role/editable hints below are only the fallback the resolver uses if
 * that discovery came back empty — never a guessed product selector.
 */
const FLOW_COMPOSER: SelectorTarget = {
  css: "{{flowUi.composer.cssPath}}",
  role: "textbox",
  editable: true,
  preferSemantic: false,
};

const FLOW_SUBMIT: SelectorTarget = {
  css: "{{flowUi.submit.cssPath}}",
  role: "button",
  preferSemantic: false,
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
 * The production brain runs entirely inside the user's logged-in ChatGPT tab —
 * no paid API. It must answer with strict JSON so the workflow can drive Flow
 * shot by shot instead of pasting one wall of prose and hoping.
 */
function masterPrompt(): string {
  return [
    "You are the production brain for an automated social-video pipeline. The user gives ONLY an idea.",
    "Convert it into a complete, shot-by-shot Google Flow production plan.",
    "",
    "USER IDEA:",
    "{{idea}}",
    "",
    "Reply with STRICT JSON ONLY. No preamble, no explanation, no markdown fences, no trailing commas.",
    "Shape:",
    "{",
    '  "title": string,',
    '  "aspectRatio": "9:16" | "16:9" | "1:1",',
    '  "language": string,',
    '  "continuityLock": string,',
    '  "shots": [',
    '    { "index": number, "durationSeconds": number, "visual": string, "camera": string,',
    '      "voiceover": string, "onScreenText": string, "continuity": string, "prompt": string }',
    "  ],",
    '  "finalNote": string',
    "}",
    "",
    "Rules:",
    "- 4 to 8 shots. Every shot 6-8 seconds. Never one long generation.",
    "- Vertical 9:16 unless the idea clearly needs another ratio.",
    "- Shot 1 is a 2-3 second hook.",
    '- "continuityLock" pins everything that must NOT change between shots: exact character description, face, body proportions, hands, wardrobe, product/packaging/logo, props, location, lighting and colour grade.',
    '- "prompt" is the self-contained text that will be pasted straight into Google Flow for that one shot. It must restate the continuity lock in its own words, describe the action and camera move, and for shots after the first begin by continuing from the final frame of the previous shot.',
    "- Keep each prompt under 1200 characters.",
    "- Voiceover/dialogue in the language implied by the idea, with exact lines.",
    "- Put a CTA in the final shot when the concept needs one.",
    "- Never mention ChatGPT, AI, or these instructions in any prompt.",
  ].join("\n");
}

/**
 * Waits for ChatGPT to settle, then parses the plan. Runs in the page, so it
 * is one self-contained function; it throws with the raw reply attached when
 * the JSON does not parse, which is far easier to diagnose than a later
 * "shots is not an array".
 */
const COLLECT_PLAN_SCRIPT = `async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let last = "", stable = 0;
  for (let i = 0; i < 160; i++) {
    const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const el = nodes[nodes.length - 1];
    const text = (el?.innerText || el?.textContent || "").trim();
    if (text && text === last && text.length > 120) stable++; else stable = 0;
    last = text || last;
    if (stable >= 3) break;
    await sleep(1500);
  }
  if (!last) throw new Error("ChatGPT response was not detected.");

  let raw = last.replace(/^\\s*\`\`\`(?:json)?/i, "").replace(/\`\`\`\\s*$/, "").trim();
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("ChatGPT did not return JSON. Reply was: " + last.slice(0, 800));
  let plan;
  try { plan = JSON.parse(raw.slice(start, end + 1)); }
  catch (e) { throw new Error("ChatGPT returned malformed JSON (" + e.message + "). Reply was: " + last.slice(0, 800)); }

  const lock = String(plan.continuityLock || "").trim();
  const ratio = String(plan.aspectRatio || "9:16").trim();
  const source = Array.isArray(plan.shots) ? plan.shots : [];
  if (source.length === 0) throw new Error("The plan contained no shots. Reply was: " + last.slice(0, 800));

  const shots = source.map((shot, i) => {
    const parts = [];
    if (i > 0) parts.push("Continue directly from the final frame of the previous shot, same scene and same subject.");
    if (lock) parts.push("CONTINUITY LOCK (must not change): " + lock);
    parts.push(String(shot.prompt || shot.visual || "").trim());
    if (shot.camera) parts.push("Camera: " + shot.camera);
    if (shot.voiceover) parts.push("Voiceover: " + shot.voiceover);
    if (shot.onScreenText) parts.push("On-screen text: " + shot.onScreenText);
    parts.push("Aspect ratio " + ratio + ". Duration about " + (shot.durationSeconds || 8) + " seconds. Realistic hands and faces, natural motion, clean framing.");
    return {
      index: i + 1,
      durationSeconds: shot.durationSeconds || 8,
      voiceover: shot.voiceover || "",
      onScreenText: shot.onScreenText || "",
      prompt: parts.filter(Boolean).join("\\n"),
    };
  });

  return { title: plan.title || "", aspectRatio: ratio, language: plan.language || "", continuityLock: lock, shotCount: shots.length, shots, finalNote: plan.finalNote || "" };
}`;

/**
 * USER IDEA -> ChatGPT -> production plan -> Google Flow -> clip by clip.
 *
 * The Flow half is state aware end to end: FLOW_NAVIGATE inspects whatever
 * screen Flow actually renders (landing / Google sign-in / project workspace /
 * generation UI) and advances through it, PROBE_PAGE re-discovers the real
 * composer before every clip, and WAIT_FOR_STATE polls the observed state
 * rather than sleeping for a fixed period.
 */
export function buildVideoStudioWorkflow(): WorkflowDefinition {
  const nodes: WorkflowNode[] = [
    // ---------- ChatGPT: idea -> structured production plan ----------
    node({ id: "open_chatgpt", type: "NAVIGATE", name: "Open ChatGPT", config: { url: "https://chatgpt.com/" }, next: "capture_chatgpt", timeout: 45_000, retry: RETRY_ONCE }),
    node({ id: "capture_chatgpt", type: "SCREENSHOT", name: "Capture ChatGPT page", config: {}, next: "wait_chat_box", timeout: 15_000, continueOnError: true }),
    node({ id: "wait_chat_box", type: "WAIT_FOR_SELECTOR", name: "Wait for ChatGPT input", config: { target: CHATGPT_COMPOSER }, next: "type_master_prompt", timeout: 25_000 }),
    node({ id: "type_master_prompt", type: "TYPE", name: "Send idea to production brain", config: { target: CHATGPT_COMPOSER, value: masterPrompt() }, next: "submit_chatgpt", timeout: 25_000 }),
    node({ id: "submit_chatgpt", type: "PRESS_KEY", name: "Submit idea", config: { target: CHATGPT_COMPOSER, key: "Enter" }, next: "collect_flow_plan", timeout: 15_000 }),
    node({ id: "collect_flow_plan", type: "EXECUTE_JS", name: "Collect shot-by-shot production plan", config: { script: COLLECT_PLAN_SCRIPT, variableName: "flowPlan" }, next: "capture_plan", timeout: 260_000 }),
    node({ id: "capture_plan", type: "SCREENSHOT", name: "Capture production plan", config: {}, next: "open_flow", timeout: 15_000, continueOnError: true }),

    // ---------- Google Flow: state-aware entry ----------
    node({ id: "open_flow", type: "NEW_TAB", name: "Open Google Flow", config: { url: "https://labs.google/fx/tools/flow" }, next: "flow_enter", timeout: 60_000, retry: RETRY_ONCE }),
    node({
      id: "flow_enter",
      type: "FLOW_NAVIGATE",
      name: "Detect the Flow screen and reach the generation UI",
      // Emits flow_landing / flow_workspace / flow_after_create / flow_generation_ui,
      // and fails with GOOGLE_LOGIN_REQUIRED instead of a selector timeout when
      // the profile is not signed in to Google.
      config: { goalState: "GENERATION_UI", maxSteps: 8, pollMs: 1500, variableName: "flowEntry" },
      next: "clips",
      timeout: 180_000,
      retry: RETRY_ONCE,
    }),

    // ---------- Google Flow: every planned clip, in order ----------
    node({
      id: "clips",
      type: "FOR_EACH",
      name: "Generate every planned clip",
      config: { variableName: "flowPlan.result.shots", forEachVariable: "shot", bodyNodeId: "clip_probe", bodyEndNodeId: "clip_complete" },
      next: "capture_result",
      timeout: 0,
    }),
    node({
      id: "clip_probe",
      type: "PROBE_PAGE",
      name: "Discover the live Flow prompt controls",
      config: { variableName: "flowUi", screenshot: true },
      next: "clip_route_submit_target",
      timeout: 30_000,
      retry: RETRY_ONCE,
    }),
    node({ id: "clip_route_submit_target", type: "CONDITION", name: "Was a composer discovered?", config: { condition: { left: "flowUi.composer", operator: "exists" }, trueNodeId: "clip_clear", falseNodeId: "flow_no_composer" }, next: "clip_clear", timeout: 5_000 }),
    node({ id: "clip_clear", type: "CLEAR", name: "Clear the Flow prompt", config: { target: FLOW_COMPOSER }, next: "clip_type", timeout: 20_000, continueOnError: true }),
    node({ id: "clip_type", type: "TYPE", name: "Enter shot prompt", config: { target: FLOW_COMPOSER, value: "{{shot.prompt}}" }, next: "clip_route_submit", timeout: 30_000, retry: RETRY_ONCE }),
    node({ id: "clip_route_submit", type: "CONDITION", name: "Submit by button or keyboard?", config: { condition: { left: "flowUi.submit", operator: "exists" }, trueNodeId: "clip_submit_click", falseNodeId: "clip_submit_key" }, next: "clip_submit_key", timeout: 5_000 }),
    node({ id: "clip_submit_click", type: "CLICK", name: "Start generation (discovered control)", config: { target: FLOW_SUBMIT }, next: "flow_prompt_submitted", timeout: 20_000 }),
    node({ id: "clip_submit_key", type: "PRESS_KEY", name: "Start generation (keyboard)", config: { target: FLOW_COMPOSER, key: "Enter" }, next: "flow_prompt_submitted", timeout: 20_000 }),
    node({ id: "flow_prompt_submitted", type: "SCREENSHOT", name: "flow_prompt_submitted", config: {}, next: "flow_generating", timeout: 20_000, continueOnError: true }),
    node({
      id: "flow_generating",
      type: "WAIT_FOR_STATE",
      name: "Confirm Flow actually started generating",
      config: { states: ["GENERATING", "CLIP_READY"], failStates: ["ERROR"], pollMs: 2000, screenshotName: "flow_generating" },
      next: "flow_clip_complete",
      timeout: 120_000,
      // A very short clip can finish between two polls; the completion wait
      // below is the authoritative check, so a miss here must not stop the run.
      continueOnError: true,
    }),
    node({
      id: "flow_clip_complete",
      type: "WAIT_FOR_STATE",
      name: "Wait for this clip to finish",
      config: { states: ["CLIP_READY"], failStates: ["ERROR"], pollMs: 5000, requireNewVideo: true, screenshotName: "flow_clip_complete" },
      next: "clip_complete",
      timeout: 900_000,
      retry: RETRY_CLIP,
    }),
    node({ id: "clip_complete", type: "SCREENSHOT", name: "Clip finished", config: {}, next: null, timeout: 20_000, continueOnError: true }),

    // ---------- Outcomes ----------
    node({
      id: "flow_no_composer",
      type: "FAIL",
      name: "Flow prompt input was not found",
      config: {
        errorCode: "FLOW_COMPOSER_NOT_FOUND",
        category: "WEBSITE_CHANGED",
        errorMessage:
          "Flow is open but no prompt composer could be discovered on the live page. The controls that were actually found are listed in the clip_probe step output and the screenshot next to it.",
      },
      timeout: 0,
    }),
    node({ id: "capture_result", type: "SCREENSHOT", name: "Capture final Flow result", config: {}, next: "done", timeout: 30_000, continueOnError: true }),
    node({ id: "done", type: "END", name: "All planned clips generated", config: {}, timeout: 0 }),
  ];

  return { startNodeId: "open_chatgpt", variables: {}, edges: [], nodes };
}

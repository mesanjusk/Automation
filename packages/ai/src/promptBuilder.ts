import type { AgentContext } from "@bos/shared";
import { AGENT_TOOLS } from "@bos/shared";

export function buildAgentPrompt(context: AgentContext): string {
  const previous = context.previousActions
    .slice(-5)
    .map((a, i) => `${i + 1}. ${a.tool} ${a.target ? JSON.stringify(a.target) : ""} — ${a.reason}`)
    .join("\n") || "(none yet)";

  return `You are a browser automation agent. You control a real web browser through a fixed set of
safe tools. You NEVER write or execute code, and you NEVER invent a tool that is not listed below.

GOAL:
${context.goal}

AVAILABLE TOOLS (choose exactly one per turn):
${AGENT_TOOLS.join(", ")}

CURRENT PAGE:
URL: ${context.page.url}
Title: ${context.page.title}
Visible text (truncated):
${context.page.visibleText.slice(0, 3000)}

Accessibility outline:
${context.page.accessibilityTree?.slice(0, 3000) ?? "(unavailable)"}

VARIABLES AVAILABLE:
${JSON.stringify(context.variables)}

RECENT ACTIONS:
${previous}

${context.lastError ? `LAST ERROR: ${context.lastError}\n` : ""}
Actions used so far: ${context.actionsSoFar} / ${context.maxActions}
${context.allowedDomains?.length ? `Allowed domains: ${context.allowedDomains.join(", ")}. Never navigate outside these.` : ""}

Respond with a single JSON object matching exactly this shape:
{
  "tool": "<one of the tools above>",
  "target": { "css": "...", "text": "...", "role": "...", "ariaLabel": "...", "testId": "...", "xpath": "..." },
  "value": "<text to type, optional>",
  "url": "<url for navigation, optional>",
  "key": "<keyboard key, optional>",
  "reason": "<why this action moves toward the goal>",
  "resultVariable": "<variable name to store extracted data under, optional>"
}
"target" is optional and only needed for element-interaction tools. Only include the fields you need.
If the goal is already achieved, use tool "task_complete". If you cannot proceed (e.g. CAPTCHA, MFA,
unexpected error page), use tool "task_fail" and explain why in "reason" — a human will be notified.
Return ONLY the JSON object, no markdown fences, no commentary.`;
}

export function buildWorkflowGenerationPrompt(description: string): string {
  return `You are designing a browser automation workflow for a generic automation platform.
Convert the user's natural-language description into a workflow DEFINITION using ONLY these node types:
NAVIGATE, CLICK, TYPE, CLEAR, SELECT, HOVER, PRESS_KEY, WAIT, WAIT_FOR_SELECTOR, WAIT_FOR_NAVIGATION,
EXTRACT_TEXT, EXTRACT_ATTRIBUTE, SCREENSHOT, UPLOAD_FILE, DOWNLOAD_FILE, NEW_TAB, SWITCH_TAB, CLOSE_TAB,
GO_BACK, GO_FORWARD, SCROLL, EXECUTE_JS, CONDITION, LOOP, FOR_EACH, SET_VARIABLE, GET_VARIABLE,
AI_DECISION, HUMAN_APPROVAL, WEBHOOK, END, FAIL.

User description:
"""
${description}
"""

Output ONLY a JSON object of this shape (no markdown fences):
{
  "startNodeId": "start",
  "nodes": [
    { "id": "start", "type": "NAVIGATE", "name": "Open site", "config": { "url": "https://..." }, "next": "..." },
    ...
    { "id": "end", "type": "END", "name": "Done", "config": {} }
  ],
  "edges": [],
  "variables": {}
}
Every node needs a unique "id" and, unless it is a terminal node (END/FAIL) or a CONDITION/LOOP node
that branches via config, a "next" pointing at the following node's id. Use SET_VARIABLE / GET_VARIABLE
for data you carry between steps, EXTRACT_TEXT/EXTRACT_ATTRIBUTE for scraping, and HUMAN_APPROVAL before
any sensitive or irreversible action (payments, purchases, deletions). Do not hard-code login passwords —
reference a variable name instead (e.g. "{{credential.password}}"). This is a DRAFT for a human to review,
edit and explicitly approve before it ever runs — do not add commentary, return only the JSON object.`;
}

export function buildVisionLocatePrompt(instruction: string): string {
  return `Look at this screenshot of a web page. Find the UI element matching: "${instruction}".
Respond with ONLY a JSON object: { "found": boolean, "description": "...", "approxBoxPercent": { "x": number, "y": number, "width": number, "height": number }, "confidence": number }
Coordinates are percentages (0-100) of image width/height from the top-left corner. If not found, set found to false.`;
}

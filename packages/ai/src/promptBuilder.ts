import type { AgentContext } from "@bos/shared";

/**
 * The tool contract, written the way a browser-extension agent is briefed:
 * every tool says what it needs and — more importantly — what it must not be
 * used for. A model that knows `browser_click` takes a ref does not invent a
 * CSS selector, and a model that has `browser_snapshot` does not guess at a
 * page it cannot currently see.
 */
const TOOL_REFERENCE = `
browser_snapshot           — re-observe the page. Use it whenever you are unsure what is on screen. Costs one action, never wrong.
browser_click   {target}   — click one control.
browser_type    {target,value} — replace a field's contents with value. The field must be [editable].
browser_clear   {target}   — empty a field.
browser_select  {target,value} — pick an option in a <select>.
browser_press   {target?,key} — send a key ("Enter", "Escape", "Tab"). Omit target to send it to the page.
browser_hover   {target}   — hover, for menus that only open on hover.
browser_scroll  {value}    — scroll the window: "up" | "down" | "top" | "bottom".
browser_scroll_to {target} — bring one off-screen control into view.
browser_wait    {value}    — wait a fixed number of milliseconds. Last resort; prefer browser_wait_for.
browser_wait_for {value}   — wait until that text appears on the page. Use this for anything slow.
browser_read    {resultVariable?} — read the page's visible text into a variable.
browser_extract {target,resultVariable} — read one element's text into a variable.
browser_screenshot         — capture the screen for the run's audit trail.
browser_navigate {url}     — go to a URL directly.
browser_back / browser_forward — history navigation.
browser_new_tab {url?} / browser_switch_tab {value:index} / browser_close_tab — tab management.
browser_upload  {target,value:absolutePath} — set a file input.
browser_download {target?} — click something that downloads a file, and save it.
task_complete   {reason}   — the goal is DONE and you have seen the evidence.
task_fail       {reason}   — you are blocked and a human must take over (CAPTCHA, MFA, a payment step, an account you cannot access).
`.trim();

const RULES = `
1. ADDRESS ELEMENTS BY REF. Every control in the snapshot has a handle like [e14]. Use {"ref":"e14"}.
   A ref points at the exact element you were shown, so it cannot resolve to the wrong one.
2. ONLY use refs from the snapshot in THIS message. Refs from earlier turns may be stale. If the control
   you want is not in the current snapshot, do not invent one — scroll, wait, or take a fresh snapshot.
3. ONE action per turn. You will see the result before choosing the next one.
4. READ "WHAT CHANGED" FIRST. If it says nothing changed, your last action did not work. Do NOT repeat it
   unchanged — something is covering the control, it is disabled, or it was the wrong element. Look again.
5. READ THE NOTICES. A modal dialog makes everything behind it unclickable: deal with the dialog first.
6. If a control is marked (disabled), satisfy whatever enables it instead of clicking it.
7. If a control is marked (off-screen), browser_scroll_to it before acting on it.
   A control marked (frame=…) lives in an embedded frame — use its ref as normal, the frame is handled for you.
8. Slow operations (uploads, generation, checkout) need browser_wait_for on the text that proves the
   operation finished — not a fixed sleep and not an optimistic task_complete.
9. NEVER type a real password or secret. Use the token {{secret:name}} as the value; it is substituted
   inside the browser and never reaches you or the logs.
10. task_complete requires EVIDENCE in the current snapshot — a confirmation message, the extracted data,
    the finished artefact. "I submitted the form" is not evidence that it succeeded.
11. Never attempt to solve a CAPTCHA, bypass MFA, or complete a payment on your own. Use task_fail.
`.trim();

function renderVariables(variables: Record<string, unknown>): string {
  const entries = Object.entries(variables).filter(([key]) => !key.startsWith("browserAgent"));
  if (entries.length === 0) return "(none)";
  return entries
    .map(([key, value]) => {
      let rendered: string;
      try {
        rendered = typeof value === "string" ? value : JSON.stringify(value);
      } catch {
        rendered = String(value);
      }
      return `${key} = ${rendered.length > 800 ? `${rendered.slice(0, 800)}… (truncated)` : rendered}`;
    })
    .join("\n");
}

export function buildAgentPrompt(context: AgentContext): string {
  const previous =
    context.previousActions
      .slice(-8)
      .map((a, i) => {
        const where = a.target?.ref ? ` ${a.target.ref}` : a.target ? ` ${JSON.stringify(a.target).slice(0, 120)}` : "";
        const what = a.value ? ` value=${JSON.stringify(a.value.slice(0, 80))}` : a.url ? ` ${a.url}` : "";
        return `${i + 1}. ${a.tool}${where}${what} — ${a.reason}`;
      })
      .join("\n") || "(none yet — this is your first action)";

  const outcome = context.lastOutcome
    ? [
        `LAST ACTION: ${context.lastOutcome.tool} — ${context.lastOutcome.status.toUpperCase()}`,
        context.lastOutcome.expectation ? `You expected: ${context.lastOutcome.expectation}` : "",
        context.lastOutcome.detail ? `Detail: ${context.lastOutcome.detail}` : "",
        `WHAT CHANGED: ${context.lastOutcome.changed ?? "(not measured)"}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const snapshot = context.page;
  const notices = snapshot.notices?.length ? snapshot.notices.map((n) => `! ${n}`).join("\n") : "(none)";
  const tabs =
    snapshot.tabs?.length && snapshot.tabs.length > 1
      ? `\nOPEN TABS:\n${snapshot.tabs.map((t) => `${t.index}: ${t.active ? "* " : "  "}"${t.title}" ${t.url}`).join("\n")}`
      : "";
  const scroll = snapshot.scroll
    ? `\nSCROLL: ${snapshot.scroll.y}px of ${snapshot.scroll.height}px${snapshot.scroll.atBottom ? " (at the bottom)" : ""}`
    : "";

  return `You are a browser automation agent driving a real Chromium browser. You cannot write or run code.
Each turn you are shown the live page and you call exactly ONE tool. The page is real: what is not in the
snapshot below does not exist as far as you are concerned.

GOAL:
${context.goal}

TOOLS:
${TOOL_REFERENCE}

RULES:
${RULES}

CURRENT PAGE
URL: ${snapshot.url}
Title: ${snapshot.title}${tabs}${scroll}

NOTICES:
${notices}

CONTROLS (act on these by ref):
${snapshot.outline ?? snapshot.accessibilityTree ?? "(no snapshot outline available)"}

VISIBLE TEXT (truncated):
${snapshot.visibleText.slice(0, 3000)}

VARIABLES:
${renderVariables(context.variables)}

RECENT ACTIONS:
${previous}
${outcome ? `\n${outcome}\n` : ""}${context.lastError ? `LAST ERROR: ${context.lastError}\n` : ""}
Actions used: ${context.actionsSoFar} / ${context.maxActions}${
    context.actionsSoFar > context.maxActions * 0.8 ? " — you are running out of budget; finish or fail." : ""
  }
${context.allowedDomains?.length ? `Allowed domains: ${context.allowedDomains.join(", ")}. Navigating anywhere else is blocked.` : ""}

Reply with ONE JSON object, no markdown fences and no commentary:
{
  "tool": "<one tool name from the list>",
  "target": { "ref": "e14", "elementDescription": "<what you believe e14 is>" },
  "value": "<text to type / scroll direction / ms / tab index — only when the tool needs it>",
  "url": "<only for browser_navigate / browser_new_tab>",
  "key": "<only for browser_press>",
  "reason": "<why this action moves toward the goal>",
  "expectation": "<what you expect to be true on the page after it>",
  "resultVariable": "<only for browser_read / browser_extract>"
}
Include only the fields the chosen tool needs. "target" is required for every tool that acts on an element.`;
}

export function buildWorkflowGenerationPrompt(description: string): string {
  return `You are designing a browser automation workflow for a generic automation platform.
Convert the user's natural-language description into a workflow DEFINITION using ONLY these node types:
NAVIGATE, CLICK, TYPE, CLEAR, SELECT, HOVER, PRESS_KEY, WAIT, WAIT_FOR_SELECTOR, WAIT_FOR_NAVIGATION,
WAIT_FOR_TEXT, SCROLL_TO_ELEMENT, EXTRACT_TEXT, EXTRACT_ATTRIBUTE, SCREENSHOT, UPLOAD_FILE, DOWNLOAD_FILE,
NEW_TAB, SWITCH_TAB, CLOSE_TAB, GO_BACK, GO_FORWARD, SCROLL, EXECUTE_JS, PROBE_PAGE, CONDITION, LOOP,
FOR_EACH, SET_VARIABLE, GET_VARIABLE, AI_DECISION, HUMAN_APPROVAL, WEBHOOK, END, FAIL.

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
for data you carry between steps, EXTRACT_TEXT/EXTRACT_ATTRIBUTE for scraping, WAIT_FOR_TEXT rather than a
fixed WAIT whenever you are waiting for the site to finish something, and HUMAN_APPROVAL before any
sensitive or irreversible action (payments, purchases, deletions). Prefer targets that survive a redesign:
{ "role": "button", "text": "Sign in", "preferSemantic": true } beats a generated CSS class. Where the page
layout is not knowable in advance, use PROBE_PAGE to discover the real controls, or AI_DECISION to let the
adaptive agent work it out at run time. Do not hard-code login passwords — reference a credential instead
(e.g. "{{secret:site_password}}"). This is a DRAFT for a human to review, edit and explicitly approve
before it ever runs — do not add commentary, return only the JSON object.`;
}

export function buildVisionLocatePrompt(instruction: string): string {
  return `Look at this screenshot of a web page. Find the UI element matching: "${instruction}".
Respond with ONLY a JSON object: { "found": boolean, "description": "...", "approxBoxPercent": { "x": number, "y": number, "width": number, "height": number }, "confidence": number }
Coordinates are percentages (0-100) of image width/height from the top-left corner. If not found, set found to false.`;
}

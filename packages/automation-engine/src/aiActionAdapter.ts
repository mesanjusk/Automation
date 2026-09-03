import type { AgentAction, NodeConfig, NodeType, WorkflowNode } from "@bos/shared";

const TOOL_TO_NODE_TYPE: Partial<Record<AgentAction["tool"], NodeType>> = {
  browser_navigate: "NAVIGATE",
  browser_click: "CLICK",
  browser_type: "TYPE",
  browser_clear: "CLEAR",
  browser_select: "SELECT",
  browser_press: "PRESS_KEY",
  browser_hover: "HOVER",
  browser_scroll: "SCROLL",
  browser_scroll_to: "SCROLL_TO_ELEMENT",
  browser_wait: "WAIT",
  browser_wait_for: "WAIT_FOR_TEXT",
  browser_snapshot: "PROBE_PAGE",
  browser_read: "EXTRACT_TEXT",
  browser_extract: "EXTRACT_TEXT",
  browser_screenshot: "SCREENSHOT",
  browser_upload: "UPLOAD_FILE",
  browser_download: "DOWNLOAD_FILE",
  browser_new_tab: "NEW_TAB",
  browser_switch_tab: "SWITCH_TAB",
  browser_close_tab: "CLOSE_TAB",
  browser_back: "GO_BACK",
  browser_forward: "GO_FORWARD",
};

const SCROLL_DIRECTIONS = new Set(["up", "down", "top", "bottom"]);

/**
 * How long a tool is allowed to take before the engine calls it stuck.
 *
 * One flat timeout is wrong in both directions: 15s is an eternity for a click
 * and far too little for "wait until the upload finishes". These are per-tool
 * so a slow-by-design tool is not killed and a fast one fails fast enough for
 * the agent to try something else while it still has budget.
 */
function timeoutFor(action: AgentAction, waitMs: number | undefined): number {
  switch (action.tool) {
    case "browser_wait":
      return Math.max(15_000, (waitMs ?? 1000) + 5000);
    case "browser_wait_for":
      return 120_000;
    case "browser_navigate":
    case "browser_new_tab":
      return 45_000;
    case "browser_download":
      return 120_000;
    case "browser_snapshot":
      return 30_000;
    default:
      return 15_000;
  }
}

/**
 * Translates a validated AI tool call into the same node shape the
 * deterministic executor understands.
 *
 * Each tool fills only the config fields it owns. An earlier version poured
 * `action.value` into every slot at once, so a scroll direction also arrived
 * as a tab index and a wait duration also arrived as a file path — harmless
 * only for as long as every node type kept ignoring fields it did not use.
 */
export function agentActionToWorkflowNode(action: AgentAction, stepId: string): WorkflowNode {
  const type = TOOL_TO_NODE_TYPE[action.tool];
  if (!type) {
    throw new Error(`AI tool "${action.tool}" is not a browser action and cannot be executed directly`);
  }

  const config: NodeConfig = {};
  if (action.target) config.target = action.target;

  switch (action.tool) {
    case "browser_navigate":
    case "browser_new_tab":
      config.url = action.url;
      break;
    case "browser_type":
    case "browser_select":
      config.value = action.value;
      break;
    case "browser_upload":
      config.filePath = action.value;
      break;
    case "browser_press":
      config.key = action.key || "Enter";
      break;
    case "browser_scroll": {
      const direction = (action.value ?? "down").toLowerCase();
      config.scrollDirection = (SCROLL_DIRECTIONS.has(direction) ? direction : "down") as NodeConfig["scrollDirection"];
      break;
    }
    case "browser_switch_tab": {
      const index = Number(action.value);
      config.tabIndex = Number.isFinite(index) ? index : 0;
      break;
    }
    case "browser_wait": {
      const ms = Number(action.value);
      // Cap it: an agent that asks to sleep for ten minutes has misunderstood
      // the page, and browser_wait_for is the right tool for a genuinely slow
      // operation.
      config.ms = Number.isFinite(ms) ? Math.min(Math.max(ms, 100), 60_000) : 1000;
      break;
    }
    case "browser_wait_for":
      config.text = action.value;
      break;
    case "browser_snapshot":
      config.screenshot = false;
      break;
    default:
      break;
  }

  const waitMs = action.tool === "browser_wait" ? config.ms : undefined;

  return {
    id: stepId,
    type,
    name: `AI: ${action.tool}${action.target?.ref ? ` ${action.target.ref}` : ""}`,
    config,
    timeout: timeoutFor(action, waitMs),
    retry: { maxRetries: 0, delayMs: 1000, exponentialBackoff: true, maxDelayMs: 30_000 },
    continueOnError: false,
  };
}

/** Tools the engine handles itself rather than executing against the page. */
export function isTerminalTool(tool: AgentAction["tool"]): boolean {
  return tool === "task_complete" || tool === "task_fail";
}

/**
 * A stable identity for "the agent just did this exact thing again".
 * Used to break the loop where a model re-issues an action that changed
 * nothing, forever.
 */
export function actionSignature(action: AgentAction): string {
  const target = action.target
    ? [action.target.ref, action.target.css, action.target.text, action.target.role, action.target.nth]
        .filter((part) => part !== undefined && part !== null)
        .join("/")
    : "";
  return `${action.tool}|${target}|${action.value ?? ""}|${action.url ?? ""}|${action.key ?? ""}`;
}

import type { AgentAction, NodeType, WorkflowNode } from "@bos/shared";

const TOOL_TO_NODE_TYPE: Partial<Record<AgentAction["tool"], NodeType>> = {
  browser_navigate: "NAVIGATE",
  browser_click: "CLICK",
  browser_type: "TYPE",
  browser_clear: "CLEAR",
  browser_select: "SELECT",
  browser_press: "PRESS_KEY",
  browser_hover: "HOVER",
  browser_scroll: "SCROLL",
  browser_wait: "WAIT",
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

/** Translates a validated AI tool call into the same node shape the deterministic executor understands. */
export function agentActionToWorkflowNode(action: AgentAction, stepId: string): WorkflowNode {
  const type = TOOL_TO_NODE_TYPE[action.tool];
  if (!type) {
    throw new Error(`AI tool "${action.tool}" is not a browser action and cannot be executed directly`);
  }
  const waitMs = action.tool === "browser_wait" ? Number(action.value || 1000) : undefined;
  return {
    id: stepId,
    type,
    name: `AI: ${action.tool}`,
    config: {
      url: action.url,
      value: action.value,
      key: action.key,
      target: action.target,
      tabIndex: action.value ? Number(action.value) : undefined,
      scrollDirection: (action.value as "up" | "down" | "top" | "bottom" | undefined) ?? "down",
      filePath: action.value,
      ms: Number.isFinite(waitMs) ? waitMs : undefined,
    },
    timeout: action.tool === "browser_wait" ? Math.max(15_000, (Number.isFinite(waitMs) ? waitMs! : 1000) + 5000) : 15_000,
    retry: { maxRetries: 0, delayMs: 1000, exponentialBackoff: true, maxDelayMs: 30_000 },
    continueOnError: false,
  };
}

import { describe, expect, it } from "vitest";
import { actionSignature, agentActionToWorkflowNode, isTerminalTool } from "./aiActionAdapter";
import type { AgentAction } from "@bos/shared";

function action(partial: Partial<AgentAction> & Pick<AgentAction, "tool">): AgentAction {
  return { reason: "because", ...partial } as AgentAction;
}

describe("agentActionToWorkflowNode", () => {
  it("carries the ref straight through to the executable node", () => {
    const node = agentActionToWorkflowNode(
      action({ tool: "browser_click", target: { ref: "e14", elementDescription: "the Continue button" } }),
      "step-1"
    );
    expect(node.type).toBe("CLICK");
    expect(node.config.target?.ref).toBe("e14");
    // The ref is in the step name too, so a human reading the run log can line
    // each step up against the snapshot the agent was looking at.
    expect(node.name).toContain("e14");
  });

  it("fills only the config fields the chosen tool owns", () => {
    // A scroll direction must not also arrive as a tab index or a file path.
    const scroll = agentActionToWorkflowNode(action({ tool: "browser_scroll", value: "down" }), "s");
    expect(scroll.config.scrollDirection).toBe("down");
    expect(scroll.config.tabIndex).toBeUndefined();
    expect(scroll.config.filePath).toBeUndefined();
    expect(scroll.config.ms).toBeUndefined();
  });

  it("falls back to a safe scroll direction rather than passing junk through", () => {
    const node = agentActionToWorkflowNode(action({ tool: "browser_scroll", value: "sideways" }), "s");
    expect(node.config.scrollDirection).toBe("down");
  });

  it("maps browser_wait_for onto a real text wait, not a sleep", () => {
    const node = agentActionToWorkflowNode(action({ tool: "browser_wait_for", value: "Order confirmed" }), "s");
    expect(node.type).toBe("WAIT_FOR_TEXT");
    expect(node.config.text).toBe("Order confirmed");
    expect(node.timeout).toBeGreaterThan(60_000);
  });

  it("caps a fixed wait so a confused agent cannot sleep away the run", () => {
    expect(agentActionToWorkflowNode(action({ tool: "browser_wait", value: "600000" }), "s").config.ms).toBe(60_000);
    expect(agentActionToWorkflowNode(action({ tool: "browser_wait", value: "not a number" }), "s").config.ms).toBe(1000);
  });

  it("gives browser_snapshot a re-observation without a screenshot", () => {
    const node = agentActionToWorkflowNode(action({ tool: "browser_snapshot" }), "s");
    expect(node.type).toBe("PROBE_PAGE");
    expect(node.config.screenshot).toBe(false);
  });

  it("gives slow tools room and keeps fast ones short", () => {
    expect(agentActionToWorkflowNode(action({ tool: "browser_click" }), "s").timeout).toBe(15_000);
    expect(agentActionToWorkflowNode(action({ tool: "browser_download" }), "s").timeout).toBe(120_000);
    expect(agentActionToWorkflowNode(action({ tool: "browser_navigate", url: "https://x.test" }), "s").timeout).toBe(45_000);
  });

  it("refuses to execute a tool the browser cannot perform", () => {
    expect(() => agentActionToWorkflowNode(action({ tool: "task_complete" }), "s")).toThrow(
      /not a browser action/
    );
  });

  it("defaults a tab index instead of producing NaN", () => {
    expect(agentActionToWorkflowNode(action({ tool: "browser_switch_tab", value: "2" }), "s").config.tabIndex).toBe(2);
    expect(agentActionToWorkflowNode(action({ tool: "browser_switch_tab" }), "s").config.tabIndex).toBe(0);
  });
});

describe("actionSignature", () => {
  it("treats the same action on the same element as a repeat", () => {
    const first = action({ tool: "browser_click", target: { ref: "e2" }, reason: "try the button" });
    const again = action({ tool: "browser_click", target: { ref: "e2" }, reason: "try it once more" });
    // The reason differs; the action does not. Only the action counts, or an
    // agent could loop forever just by rewording its justification.
    expect(actionSignature(first)).toBe(actionSignature(again));
  });

  it("separates the same tool aimed at different elements", () => {
    expect(actionSignature(action({ tool: "browser_click", target: { ref: "e2" } }))).not.toBe(
      actionSignature(action({ tool: "browser_click", target: { ref: "e3" } }))
    );
  });

  it("separates typing different values into the same field", () => {
    expect(actionSignature(action({ tool: "browser_type", target: { ref: "e1" }, value: "a" }))).not.toBe(
      actionSignature(action({ tool: "browser_type", target: { ref: "e1" }, value: "b" }))
    );
  });
});

describe("isTerminalTool", () => {
  it("identifies the tools the engine resolves itself", () => {
    expect(isTerminalTool("task_complete")).toBe(true);
    expect(isTerminalTool("task_fail")).toBe(true);
    expect(isTerminalTool("browser_click")).toBe(false);
  });
});

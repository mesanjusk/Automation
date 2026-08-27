import { describe, expect, it } from "vitest";
import { validateWorkflowDefinition, workflowDefinitionSchema } from "@bos/shared";
import { buildVideoStudioWorkflow } from "./videoStudioWorkflow";

const definition = buildVideoStudioWorkflow();
const byId = new Map(definition.nodes.map((node) => [node.id, node]));

describe("Video Studio workflow definition", () => {
  it("parses against the shared workflow schema", () => {
    expect(() => workflowDefinitionSchema.parse(definition)).not.toThrow();
  });

  it("has no dangling node references", () => {
    expect(validateWorkflowDefinition(definition)).toEqual([]);
  });

  it("reaches Google Flow through the state-aware navigator, not a bare selector wait", () => {
    const navigator = byId.get("flow_enter");
    expect(navigator?.type).toBe("FLOW_NAVIGATE");
    expect(navigator?.config.goalState).toBe("GENERATION_UI");
    // The old workflow waited on {role:"textbox", css:"textarea, [contenteditable='true']"}
    // straight after opening Flow. Nothing may do that again.
    const flowNodeIds = definition.nodes.map((node) => node.id);
    const openFlowIndex = flowNodeIds.indexOf("open_flow");
    for (const node of definition.nodes.slice(openFlowIndex)) {
      expect(node.type).not.toBe("WAIT_FOR_SELECTOR");
    }
  });

  it("generates every planned clip rather than only the first prompt", () => {
    const loop = byId.get("clips");
    expect(loop?.type).toBe("FOR_EACH");
    expect(loop?.config.variableName).toBe("flowPlan.result.shots");
    expect(loop?.config.forEachVariable).toBe("shot");
    expect(byId.has(String(loop?.config.bodyNodeId))).toBe(true);
    expect(byId.has(String(loop?.config.bodyEndNodeId))).toBe(true);
    expect(byId.get("clip_type")?.config.value).toBe("{{shot.prompt}}");
  });

  it("waits on observed Flow states instead of fixed sleeps", () => {
    expect(definition.nodes.some((node) => node.type === "WAIT")).toBe(false);
    const complete = byId.get("flow_clip_complete");
    expect(complete?.type).toBe("WAIT_FOR_STATE");
    expect(complete?.config.states).toEqual(["CLIP_READY"]);
    expect(complete?.config.failStates).toEqual(["ERROR"]);
    expect(complete?.config.requireNewVideo).toBe(true);
    expect(complete?.timeout).toBeGreaterThan(0);
  });

  it("re-discovers the live Flow controls before every clip", () => {
    const probe = byId.get("clip_probe");
    expect(probe?.type).toBe("PROBE_PAGE");
    expect(probe?.config.variableName).toBe("flowUi");
    // The composer selector is whatever the probe found on the real page.
    expect(byId.get("clip_type")?.config.target?.css).toBe("{{flowUi.composer.cssPath}}");
  });

  it("produces the named screenshots the dashboard needs at every Flow transition", () => {
    const emitted = new Set<string>();
    for (const node of definition.nodes) {
      if (node.type === "SCREENSHOT") emitted.add(node.id);
      if (typeof node.config.screenshotName === "string") emitted.add(node.config.screenshotName);
    }
    // flow_landing / flow_after_create / flow_workspace / flow_generation_ui /
    // flow_error come from FLOW_NAVIGATE itself (see FLOW_SCREENSHOTS).
    expect(emitted).toContain("flow_prompt_submitted");
    expect(emitted).toContain("flow_generating");
    expect(emitted).toContain("flow_clip_complete");
  });

  it("fails with a diagnosable code when Flow has no discoverable composer", () => {
    const fail = byId.get("flow_no_composer");
    expect(fail?.type).toBe("FAIL");
    expect(fail?.config.errorCode).toBe("FLOW_COMPOSER_NOT_FOUND");
    expect(fail?.config.category).toBe("WEBSITE_CHANGED");
  });
});

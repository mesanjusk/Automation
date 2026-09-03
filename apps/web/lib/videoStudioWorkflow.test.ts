import { describe, expect, it } from "vitest";
import { validateWorkflowDefinition, workflowDefinitionSchema } from "@bos/shared";
import { buildVideoStudioWorkflow } from "./videoStudioWorkflow";

const definition = buildVideoStudioWorkflow();
const byId = new Map(definition.nodes.map((node) => [node.id, node]));

/**
 * The Flow half of this workflow is deliberately NOT a state machine.
 *
 * An earlier version hard-coded the screens and selectors Google Flow happened
 * to have at the time, and every redesign broke it. It was replaced by a single
 * adaptive agent node that observes the live page each turn and picks one
 * action. These tests pin that shape: no guessed Flow selector may creep back
 * in, and the agent's brief must still demand real completion evidence.
 */
describe("Video Studio workflow definition", () => {
  it("parses against the shared workflow schema", () => {
    expect(() => workflowDefinitionSchema.parse(definition)).not.toThrow();
  });

  it("has no dangling node references", () => {
    expect(validateWorkflowDefinition(definition)).toEqual([]);
  });

  it("drives Google Flow through the adaptive browser agent", () => {
    const agent = byId.get("flow_browser_agent");
    expect(agent?.type).toBe("AI_DECISION");
    // No timeout: a full video mission is minutes of generation, and the agent
    // has its own action budget plus the engine's loop guard to bound it.
    expect(agent?.timeout).toBe(0);
  });

  it("never guesses a Flow selector — nothing after the Flow tab opens targets an element", () => {
    const ids = definition.nodes.map((node) => node.id);
    const openFlowIndex = ids.indexOf("open_flow");
    expect(openFlowIndex).toBeGreaterThan(-1);

    for (const node of definition.nodes.slice(openFlowIndex)) {
      expect(node.type).not.toBe("WAIT_FOR_SELECTOR");
      // Every element the agent touches comes from a live observation, so no
      // node may carry a pre-baked target for a page nobody has looked at yet.
      expect(node.config.target, `${node.id} must not hard-code a Flow selector`).toBeUndefined();
    }
  });

  it("holds the agent to the whole mission, not just the first prompt", () => {
    const brief = String(byId.get("flow_browser_agent")?.config.prompt ?? "");
    expect(brief).toMatch(/every planned clip/i);
    expect(brief).toMatch(/wait for actual generation completion/i);
    expect(brief).toMatch(/do not stop after prompt submission/i);
  });

  it("plans with ChatGPT before it touches Flow, and keeps the plan in a variable", () => {
    expect(byId.get("open_chatgpt")?.type).toBe("NAVIGATE");
    const collect = byId.get("collect_flow_plan");
    expect(collect?.type).toBe("EXECUTE_JS");
    expect(collect?.config.variableName).toBe("flowPlan");
    // The Flow agent's brief has to reference the plan or the two halves are
    // not actually connected.
    expect(String(byId.get("flow_browser_agent")?.config.prompt)).toContain("flowPlan");
  });

  it("opens Flow in its own tab so the planner conversation stays alive", () => {
    const openFlow = byId.get("open_flow");
    expect(openFlow?.type).toBe("NEW_TAB");
    expect(openFlow?.config.url).toContain("labs.google");
  });

  it("captures screenshots either side of the agent run for the audit trail", () => {
    const screenshots = definition.nodes.filter((node) => node.type === "SCREENSHOT");
    expect(screenshots.length).toBeGreaterThanOrEqual(2);
    // A screenshot must never be able to fail the run it exists to document.
    for (const shot of screenshots) expect(shot.continueOnError).toBe(true);
  });

  it("ends on an explicit END node rather than running off the graph", () => {
    expect(byId.get("done")?.type).toBe("END");
  });
});

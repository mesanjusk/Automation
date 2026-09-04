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
    expect(byId.get("collect_plan_reply")?.type).toBe("EXECUTE_JS");
    expect(byId.get("parse_plan")?.config.variableName).toBe("flowPlan");
    // The Flow agent's brief has to reference the plan or the two halves are
    // not actually connected.
    expect(String(byId.get("flow_browser_agent")?.config.prompt)).toContain("flowPlan");
  });

  it("reads the planner's reply and parses it as two separate steps", () => {
    // The read cannot fail on the shape of the answer and the parse cannot
    // fail on the speed of it, so each failure names its own cause.
    const read = byId.get("collect_plan_reply");
    expect(read?.type).toBe("EXECUTE_JS");
    expect(read?.config.variableName).toBe("planReply");
    // The page script only waits and returns text — no parsing in the page.
    expect(String(read?.config.script)).not.toContain("JSON.parse");

    const parse = byId.get("parse_plan");
    expect(parse?.type).toBe("PARSE_JSON");
    expect(parse?.config.sourceVariable).toBe("planReply.result.text");
    expect(parse?.config.require).toEqual(["shots"]);
  });

  it("waits on the planner's own completion signals, not on a fixed sleep", () => {
    // Text stability alone is satisfied every time a streamed reply pauses to
    // think, which is how a half-written plan got read as a finished one.
    const script = String(byId.get("collect_plan_reply")?.config.script);
    expect(script).toContain("stop-button");
    expect(script).toContain("copy-turn-action-button");
    expect(byId.get("collect_plan_reply")?.timeout).toBeGreaterThan(600_000);
  });

  it("asks the planner to fix a malformed reply instead of ending the run", () => {
    const branch = byId.get("plan_ready");
    expect(branch?.type).toBe("CONDITION");
    expect(branch?.config.condition).toMatchObject({ left: "flowPlan", operator: "exists" });
    expect(branch?.config.trueNodeId).toBe("capture_plan");
    expect(branch?.config.falseNodeId).toBe("request_valid_json");

    // A failed parse must not stop the run before the correction can be asked
    // for — that is the whole point of the branch.
    expect(byId.get("parse_plan")?.continueOnError).toBe(true);

    const ask = byId.get("request_valid_json");
    expect(ask?.type).toBe("TYPE");
    // It has to tell the planner what was actually wrong.
    expect(String(ask?.config.value)).toContain("{{flowPlanError}}");
    expect(byId.get("submit_valid_json")?.type).toBe("PRESS_KEY");
    expect(byId.get("parse_plan_retry")?.type).toBe("PARSE_JSON");
    expect(byId.get("plan_ready_retry")?.config.trueNodeId).toBe("capture_plan");
  });

  it("fails a hopeless plan diagnosably and retryably, not as PERMANENT", () => {
    // One bad generation is not a broken workflow; filing it as PERMANENT
    // strands a run that is one retry from working.
    const fail = byId.get("plan_unusable");
    expect(fail?.type).toBe("FAIL");
    expect(fail?.config.errorCode).toBe("PLAN_JSON_UNUSABLE");
    expect(fail?.config.category).toBe("TRANSIENT");
    expect(fail?.config.retryable).toBe(true);
    expect(String(fail?.config.errorMessage)).toContain("{{flowPlanError}}");
  });

  it("routes both the happy path and the corrected path into the same continuation", () => {
    for (const id of ["plan_ready", "plan_ready_retry"]) {
      expect(byId.get(id)?.config.trueNodeId).toBe("capture_plan");
    }
    expect(byId.get("capture_plan")?.next).toBe("open_flow");
  });

  it("waits for a person to sign in to both sites before it does anything", () => {
    // The reported failure: the run reached Google Flow signed out and died as
    // HUMAN_INTERVENTION_REQUIRED. Signing in is not automated — the run opens
    // the tabs and waits.
    expect(definition.startNodeId).toBe("manual_sign_in");
    const gate = byId.get("manual_sign_in");
    expect(gate?.type).toBe("WAIT_FOR_LOGIN");
    expect(gate?.config.urls).toEqual(["https://chatgpt.com/", "https://labs.google/fx/tools/flow"]);
    expect(String(gate?.config.message)).toMatch(/sign in to both/i);
  });

  it("reuses the signed-in Flow tab rather than opening a second, signed-out one", () => {
    const openFlow = byId.get("open_flow");
    expect(openFlow?.type).toBe("SWITCH_TAB");
    expect(openFlow?.config.tabIndex).toBe(1);
    // Nothing may re-open Flow in a fresh tab after the gate: that tab would
    // not carry the sign-in the person just did.
    const reopens = definition.nodes.filter(
      (n) => n.type === "NEW_TAB" && String(n.config.url ?? "").includes("labs.google")
    );
    expect(reopens).toEqual([]);
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

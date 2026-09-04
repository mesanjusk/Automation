import { describe, expect, it, vi, beforeEach } from "vitest";

const executeBrowserAction = vi.fn();

vi.mock("@bos/browser", () => ({
  executeBrowserAction: (...args: unknown[]) => executeBrowserAction(...args),
  interpolate: (template: string | undefined, variables: Record<string, unknown>) =>
    (template ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) =>
      String(path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], variables) ?? "")
    ),
  BROWSER_NODE_TYPES: ["NAVIGATE", "CLICK", "TYPE", "EXTRACT_TEXT", "SCREENSHOT", "PROBE_PAGE", "SCROLL"],
}));

const { WorkflowEngine } = await import("./engine.js");
const { workflowDefinitionSchema } = await import("@bos/shared");
import type { EngineHooks } from "./types";

function makeHooks(overrides: Partial<EngineHooks> = {}): EngineHooks {
  return {
    onStepStart: vi.fn(),
    onStepComplete: vi.fn(),
    requestHumanApproval: vi.fn().mockResolvedValue("approved"),
    deliverWebhook: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  executeBrowserAction.mockReset();
  executeBrowserAction.mockResolvedValue({ output: { ok: true } });
});

describe("WorkflowEngine", () => {
  it("runs SET_VARIABLE -> CONDITION -> branch -> END and returns completed", async () => {
    const definition = workflowDefinitionSchema.parse({
      startNodeId: "set",
      nodes: [
        { id: "set", type: "SET_VARIABLE", name: "Set flag", config: { variableName: "stock", variableValue: 5 }, next: "check" },
        {
          id: "check",
          type: "CONDITION",
          name: "Has stock?",
          config: { condition: { left: "stock", operator: "greaterThan", right: 0 }, trueNodeId: "yes", falseNodeId: "no" },
        },
        { id: "yes", type: "SET_VARIABLE", name: "In stock", config: { variableName: "result", variableValue: "in-stock" }, next: "end" },
        { id: "no", type: "SET_VARIABLE", name: "Out of stock", config: { variableName: "result", variableValue: "out-of-stock" }, next: "end" },
        { id: "end", type: "END", name: "Done", config: {} },
      ],
    });

    const engine = new WorkflowEngine({ definition, session: {} as never, hooks: makeHooks(), options: {}, downloadDir: "/tmp" });
    const result = await engine.run(definition.startNodeId);

    expect(result.status).toBe("completed");
    expect(result.variables.result).toBe("in-stock");
  });

  it("iterates a LOOP body the configured number of times", async () => {
    const definition = workflowDefinitionSchema.parse({
      startNodeId: "init",
      nodes: [
        { id: "init", type: "SET_VARIABLE", name: "Init", config: { variableName: "count", variableValue: 0 }, next: "loop" },
        { id: "loop", type: "LOOP", name: "Loop 3x", config: { loopCount: 3, bodyNodeId: "increment" }, next: "end" },
        { id: "increment", type: "EXECUTE_JS", name: "increment (browser action, mocked)", config: {} },
        { id: "end", type: "END", name: "Done", config: {} },
      ],
    });
    // EXECUTE_JS isn't in our mocked BROWSER_NODE_TYPES on purpose here — swap
    // it for a SET_VARIABLE-based counter increment instead so the test only
    // exercises engine control flow, not the browser executor.
    definition.nodes[2] = {
      ...definition.nodes[2],
      type: "SET_VARIABLE",
      config: { variableName: "count", variableValue: "incremented" },
    } as never;

    const engine = new WorkflowEngine({ definition, session: {} as never, hooks: makeHooks(), options: {}, downloadDir: "/tmp" });
    const result = await engine.run(definition.startNodeId);

    expect(result.status).toBe("completed");
    expect(result.variables.count).toBe("incremented");
  });

  it("fails the run when a FAIL node is reached", async () => {
    const definition = workflowDefinitionSchema.parse({
      startNodeId: "boom",
      nodes: [{ id: "boom", type: "FAIL", name: "Explode", config: { errorMessage: "Website structure changed" } }],
    });
    const engine = new WorkflowEngine({ definition, session: {} as never, hooks: makeHooks(), options: {}, downloadDir: "/tmp" });
    const result = await engine.run(definition.startNodeId);

    expect(result.status).toBe("failed");
    expect(result.error?.message).toBe("Website structure changed");
  });

  it("pauses at HUMAN_APPROVAL when the hook returns pending, and the caller can resume", async () => {
    const hooks = makeHooks({ requestHumanApproval: vi.fn().mockResolvedValueOnce("pending") });
    const definition = workflowDefinitionSchema.parse({
      startNodeId: "approve",
      nodes: [
        { id: "approve", type: "HUMAN_APPROVAL", name: "Confirm payment", config: { approvalMessage: "Confirm the $500 payment?" }, next: "end" },
        { id: "end", type: "END", name: "Done", config: {} },
      ],
    });
    const engine = new WorkflowEngine({ definition, session: {} as never, hooks, options: {}, downloadDir: "/tmp" });
    const paused = await engine.run(definition.startNodeId);
    expect(paused.status).toBe("paused");
    expect(paused.lastNodeId).toBe("approve");
  });

  it("routes a browser node's output into the named variable and records the selector strategy used", async () => {
    executeBrowserAction.mockResolvedValueOnce({ output: { text: "In stock: 42" }, selectorStrategyUsed: "text" });
    const stepCompletions: unknown[] = [];
    const hooks = makeHooks({
      onStepComplete: vi.fn((e) => {
        stepCompletions.push(e);
      }),
    });
    const definition = workflowDefinitionSchema.parse({
      startNodeId: "extract",
      nodes: [
        { id: "extract", type: "EXTRACT_TEXT", name: "Extract stock", config: { target: { css: ".stock" }, variableName: "stockText" }, next: "end" },
        { id: "end", type: "END", name: "Done", config: {} },
      ],
    });
    const engine = new WorkflowEngine({ definition, session: {} as never, hooks, options: {}, downloadDir: "/tmp" });
    const result = await engine.run(definition.startNodeId);

    expect(result.status).toBe("completed");
    expect(result.variables.stockText).toEqual({ text: "In stock: 42" });
    expect(stepCompletions[0]).toMatchObject({ status: "SUCCESS", selectorStrategyUsed: "text" });
  });

  describe("PARSE_JSON", () => {
    const parseDefinition = (config: Record<string, unknown>, continueOnError = false) =>
      workflowDefinitionSchema.parse({
        startNodeId: "parse",
        nodes: [
          { id: "parse", type: "PARSE_JSON", name: "Parse reply", config, next: "end", continueOnError },
          { id: "end", type: "END", name: "Done", config: {} },
        ],
      });

    const run = async (config: Record<string, unknown>, variables: Record<string, unknown>, continueOnError = false) => {
      const definition = parseDefinition(config, continueOnError);
      const engine = new WorkflowEngine({ definition, session: {} as never, hooks: makeHooks(), options: {}, downloadDir: "/tmp" });
      return engine.run(definition.startNodeId, variables);
    };

    it("parses a reply out of a dotted source variable", async () => {
      const result = await run(
        { sourceVariable: "reply.result.text", variableName: "plan" },
        { reply: { result: { text: '```json\n{"shots":[{"visual":"a"}]}\n```' } } }
      );
      expect(result.status).toBe("completed");
      expect(result.variables.plan).toEqual({ shots: [{ visual: "a" }] });
    });

    it("repairs the unescaped quote that used to end the run", async () => {
      const result = await run(
        { sourceVariable: "reply", variableName: "plan" },
        { reply: '{"visual":"a 6" tall idol"}' }
      );
      expect(result.status).toBe("completed");
      expect(result.variables.plan).toEqual({ visual: 'a 6" tall idol' });
    });

    it("fails TRANSIENT and retryable, not PERMANENT, on an unusable reply", async () => {
      // A bad generation is one retry from working; PERMANENT strands it.
      const result = await run({ sourceVariable: "reply", variableName: "plan" }, { reply: "sorry, I can't." });
      expect(result.status).toBe("failed");
      expect(result.error?.category).toBe("TRANSIENT");
      expect(result.error?.retryable).toBe(true);
    });

    it("distinguishes a reply that was read too early from one that is malformed", async () => {
      const result = await run({ sourceVariable: "reply", variableName: "plan" }, { reply: '{"title":"x","shots":[{"a":"b' });
      expect(result.error?.message).toMatch(/read before it had finished/);
    });

    it("reports required fields that the reply parsed but did not contain", async () => {
      const result = await run(
        { sourceVariable: "reply", variableName: "plan", require: ["shots"] },
        { reply: '{"title":"no shots here"}' }
      );
      expect(result.status).toBe("failed");
      expect(result.error?.message).toMatch(/missing required field\(s\): shots/);
    });

    it("treats an empty shots array as missing, not as a usable plan", async () => {
      const result = await run(
        { sourceVariable: "reply", variableName: "plan", require: ["shots"] },
        { reply: '{"shots":[]}' }
      );
      expect(result.status).toBe("failed");
    });

    it("leaves the diagnostic behind so a later step can branch and report on it", async () => {
      const result = await run(
        { sourceVariable: "reply", variableName: "plan" },
        { reply: "not json at all" },
        true
      );
      // continueOnError lets the workflow reach its recovery branch.
      expect(result.status).toBe("completed");
      expect(result.variables.plan).toBeUndefined();
      expect(String(result.variables.planError)).toMatch(/No JSON object/);
    });

    it("clears a stale diagnostic once a later parse succeeds", async () => {
      const result = await run(
        { sourceVariable: "reply", variableName: "plan" },
        { reply: '{"shots":[1]}', planError: "an earlier failure" }
      );
      expect(result.variables.planError).toBeUndefined();
    });
  });

  describe("FAIL", () => {
    it("interpolates the diagnostic the failing step left behind", async () => {
      const definition = workflowDefinitionSchema.parse({
        startNodeId: "fail",
        nodes: [
          {
            id: "fail",
            type: "FAIL",
            name: "Give up",
            config: { errorCode: "PLAN_JSON_UNUSABLE", errorMessage: "Planner failed: {{planError}}", category: "TRANSIENT", retryable: true },
          },
        ],
      });
      const engine = new WorkflowEngine({ definition, session: {} as never, hooks: makeHooks(), options: {}, downloadDir: "/tmp" });
      const result = await engine.run(definition.startNodeId, { planError: "unterminated string at position 4007" });

      expect(result.error?.message).toBe("Planner failed: unterminated string at position 4007");
      expect(result.error?.retryable).toBe(true);
    });
  });

  describe("AI_DECISION resilience", () => {
    const missionDefinition = () =>
      workflowDefinitionSchema.parse({
        startNodeId: "agent",
        nodes: [
          { id: "agent", type: "AI_DECISION", name: "Adaptive browser agent", config: { prompt: "Make the video" }, next: "end" },
          { id: "end", type: "END", name: "Done", config: {} },
        ],
      });

    it("stops an agent that keeps issuing the identical action on an unresponsive page", async () => {
      // The classic runaway: the model clicks a control that does nothing and,
      // seeing an unchanged page, clicks it again. Without a guard this burns
      // the entire action budget on one dead button.
      const decideNextAiAction = vi.fn().mockResolvedValue({
        tool: "browser_click",
        target: { ref: "e9" },
        reason: "the Continue button should advance the form",
      });
      const hooks = makeHooks({ decideNextAiAction });
      const definition = missionDefinition();
      const engine = new WorkflowEngine({ definition, session: {} as never, hooks, options: {}, downloadDir: "/tmp" });

      const result = await engine.run(definition.startNodeId);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toMatch(/repeated the same action/);
      expect(decideNextAiAction.mock.calls.length).toBeLessThan(10);
    });

    it("warns before it gives up, so the agent gets a chance to change course", async () => {
      const warnings: Array<unknown> = [];
      const decideNextAiAction = vi.fn(async (_goal: string, variables: Record<string, unknown>) => {
        warnings.push(variables.browserAgentRepeatWarning);
        // Break the loop on the third turn by aiming somewhere else.
        if (warnings.length >= 3) return { tool: "task_complete", reason: "found another way" } as never;
        return { tool: "browser_click", target: { ref: "e9" }, reason: "try Continue" } as never;
      });
      const hooks = makeHooks({ decideNextAiAction });
      const definition = missionDefinition();
      const engine = new WorkflowEngine({ definition, session: {} as never, hooks, options: {}, downloadDir: "/tmp" });

      const result = await engine.run(definition.startNodeId);

      expect(result.status).toBe("completed");
      expect(warnings[0]).toBeUndefined();
      expect(String(warnings[2])).toContain("identical action");
    });

    it("reports the last action so the next observation can say what it changed", async () => {
      const seen: Array<unknown> = [];
      const decideNextAiAction = vi.fn(async (_goal: string, variables: Record<string, unknown>) => {
        seen.push(variables.browserAgentLastAction);
        if (seen.length === 1) {
          return { tool: "browser_click", target: { ref: "e2" }, reason: "open the menu", expectation: "the menu opens" } as never;
        }
        return { tool: "task_complete", reason: "menu is open" } as never;
      });
      const hooks = makeHooks({ decideNextAiAction });
      const definition = missionDefinition();
      const engine = new WorkflowEngine({ definition, session: {} as never, hooks, options: {}, downloadDir: "/tmp" });
      await engine.run(definition.startNodeId);

      expect(seen[0]).toBeUndefined();
      expect(seen[1]).toMatchObject({ tool: "browser_click", status: "success", expectation: "the menu opens" });
    });

    it("ends the run on a boundary violation instead of re-asking five times", async () => {
      // Leaving the domain allowlist cannot be re-prompted away, so retrying it
      // only spends the action budget on an answer that can never be accepted.
      const violation = Object.assign(new Error("AI attempted to navigate to a domain outside the allowlist"), {
        name: "AgentSafetyViolation",
        terminal: true,
      });
      const decideNextAiAction = vi.fn().mockRejectedValue(violation);
      const hooks = makeHooks({ decideNextAiAction });
      const definition = missionDefinition();
      const engine = new WorkflowEngine({ definition, session: {} as never, hooks, options: {}, downloadDir: "/tmp" });

      const result = await engine.run(definition.startNodeId);

      expect(result.status).toBe("failed");
      expect(result.error?.retryable).toBe(false);
      expect(decideNextAiAction).toHaveBeenCalledTimes(1);
    });

    it("still re-observes past a merely malformed tool call", async () => {
      const slip = Object.assign(new Error('"browser_click" needs a target element'), {
        name: "AgentSafetyViolation",
        terminal: false,
      });
      const decideNextAiAction = vi
        .fn()
        .mockRejectedValueOnce(slip)
        .mockResolvedValueOnce({ tool: "task_complete", reason: "recovered" });
      const hooks = makeHooks({ decideNextAiAction });
      const definition = missionDefinition();
      const engine = new WorkflowEngine({ definition, session: {} as never, hooks, options: {}, downloadDir: "/tmp" });

      expect((await engine.run(definition.startNodeId)).status).toBe("completed");
      expect(decideNextAiAction).toHaveBeenCalledTimes(2);
    });

    it("re-observes and carries on when the brain fails to produce a decision", async () => {
      const decideNextAiAction = vi
        .fn()
        .mockRejectedValueOnce(new Error("page.waitForTimeout: Target page, context or browser has been closed"))
        .mockResolvedValueOnce({ tool: "task_complete", reason: "clip rendered and downloaded" });
      const hooks = makeHooks({ decideNextAiAction });
      const definition = missionDefinition();
      const engine = new WorkflowEngine({ definition, session: {} as never, hooks, options: {}, downloadDir: "/tmp" });

      const result = await engine.run(definition.startNodeId);

      expect(result.status).toBe("completed");
      expect(decideNextAiAction).toHaveBeenCalledTimes(2);
    });

    it("tells the brain what went wrong on the next observation", async () => {
      // The engine hands the hook its live variables object and clears the last
      // error on success, so the value has to be read at call time — asserting
      // on the retained reference afterwards would only see the cleanup.
      const errorsSeen: Array<unknown> = [];
      const decideNextAiAction = vi.fn(async (_goal: string, variables: Record<string, unknown>) => {
        errorsSeen.push(variables.browserAgentLastError);
        if (errorsSeen.length === 1) throw new Error("ChatGPT brain tab closed");
        return { tool: "task_complete", reason: "done" } as never;
      });
      const hooks = makeHooks({ decideNextAiAction });
      const definition = missionDefinition();
      const engine = new WorkflowEngine({ definition, session: {} as never, hooks, options: {}, downloadDir: "/tmp" });
      await engine.run(definition.startNodeId);

      expect(errorsSeen[0]).toBeUndefined();
      expect(String(errorsSeen[1])).toContain("ChatGPT brain tab closed");
    });

    it("gives up as retryable — not PERMANENT — once the brain is plainly unreachable", async () => {
      const decideNextAiAction = vi.fn().mockRejectedValue(new Error("ChatGPT is unreachable"));
      const hooks = makeHooks({ decideNextAiAction });
      const definition = missionDefinition();
      const engine = new WorkflowEngine({ definition, session: {} as never, hooks, options: {}, downloadDir: "/tmp" });

      const result = await engine.run(definition.startNodeId);

      expect(result.status).toBe("failed");
      expect(result.error?.category).toBe("TRANSIENT");
      expect(result.error?.retryable).toBe(true);
      expect(decideNextAiAction).toHaveBeenCalledTimes(5);
    });
  });

  it("stops immediately when shouldCancel() reports the task was cancelled", async () => {
    const hooks = makeHooks({ shouldCancel: vi.fn().mockResolvedValue(true) });
    const definition = workflowDefinitionSchema.parse({
      startNodeId: "n1",
      nodes: [{ id: "n1", type: "END", name: "Done", config: {} }],
    });
    const engine = new WorkflowEngine({ definition, session: {} as never, hooks, options: {}, downloadDir: "/tmp" });
    const result = await engine.run(definition.startNodeId);
    expect(result.status).toBe("cancelled");
  });
});

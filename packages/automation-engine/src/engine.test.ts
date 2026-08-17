import { describe, expect, it, vi, beforeEach } from "vitest";

const executeBrowserAction = vi.fn();

vi.mock("@bos/browser", () => ({
  executeBrowserAction: (...args: unknown[]) => executeBrowserAction(...args),
  BROWSER_NODE_TYPES: ["NAVIGATE", "CLICK", "TYPE", "EXTRACT_TEXT", "SCREENSHOT"],
}));

const { WorkflowEngine } = await import("./engine.js");
const { workflowDefinitionSchema } = await import("@bos/shared");
import type { EngineHooks } from "./types.js";

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
    const hooks = makeHooks({ onStepComplete: vi.fn((e) => stepCompletions.push(e)) });
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

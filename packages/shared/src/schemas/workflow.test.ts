import { describe, expect, it } from "vitest";
import { validateWorkflowDefinition, workflowDefinitionSchema, workflowNodeSchema, type WorkflowNode } from "./workflow";
import type { z } from "zod";

function baseNode(overrides: Partial<z.input<typeof workflowNodeSchema>> = {}): WorkflowNode {
  return workflowNodeSchema.parse({
    id: "n1",
    type: "NAVIGATE",
    name: "Navigate",
    config: {},
    ...overrides,
  });
}

describe("workflowDefinitionSchema", () => {
  it("accepts a minimal valid definition", () => {
    const def = { startNodeId: "n1", nodes: [baseNode()], edges: [], variables: {} };
    const parsed = workflowDefinitionSchema.parse(def);
    expect(parsed.nodes).toHaveLength(1);
  });

  it("applies default retry/timeout when omitted", () => {
    const def = workflowDefinitionSchema.parse({
      startNodeId: "n1",
      nodes: [{ id: "n1", type: "END", name: "Done", config: {} }],
    });
    expect(def.nodes[0]?.retry.maxRetries).toBe(0);
    expect(def.nodes[0]?.timeout).toBe(30000);
  });

  it("rejects an unknown node type", () => {
    expect(() =>
      workflowDefinitionSchema.parse({ startNodeId: "n1", nodes: [{ id: "n1", type: "NOT_A_TYPE", name: "x", config: {} }] })
    ).toThrow();
  });
});

describe("validateWorkflowDefinition", () => {
  it("flags a startNodeId that does not exist", () => {
    const def = workflowDefinitionSchema.parse({ startNodeId: "missing", nodes: [baseNode()] });
    const errors = validateWorkflowDefinition(def);
    expect(errors.some((e) => e.includes("startNodeId"))).toBe(true);
  });

  it("flags a .next pointing at a missing node", () => {
    const def = workflowDefinitionSchema.parse({ startNodeId: "n1", nodes: [baseNode({ next: "ghost" })] });
    const errors = validateWorkflowDefinition(def);
    expect(errors.some((e) => e.includes("ghost"))).toBe(true);
  });

  it("flags a CONDITION node with a missing trueNodeId", () => {
    const def = workflowDefinitionSchema.parse({
      startNodeId: "n1",
      nodes: [baseNode({ type: "CONDITION", config: { trueNodeId: "ghost" } })],
    });
    const errors = validateWorkflowDefinition(def);
    expect(errors.some((e) => e.includes("trueNodeId"))).toBe(true);
  });

  it("passes a well-formed multi-node graph", () => {
    const def = workflowDefinitionSchema.parse({
      startNodeId: "n1",
      nodes: [baseNode({ next: "n2" }), baseNode({ id: "n2", type: "END", next: undefined })],
    });
    expect(validateWorkflowDefinition(def)).toHaveLength(0);
  });
});

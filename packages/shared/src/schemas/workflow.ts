import { z } from "zod";
import { FAILURE_CATEGORIES, NODE_TYPES } from "../enums";

export const retryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(20).default(0),
  delayMs: z.number().int().min(0).default(1000),
  exponentialBackoff: z.boolean().default(true),
  maxDelayMs: z.number().int().min(0).default(30_000),
});
export type RetryPolicy = z.infer<typeof retryPolicySchema>;

// A "target" describes how to locate an element. All fields are optional and
// tried in priority order by the selector resolver (see packages/browser).
export const selectorTargetSchema = z.object({
  /**
   * Exact handle for an element the agent was just shown in a page snapshot
   * (`e12`). Stamped onto the real DOM node at snapshot time, so it identifies
   * that node and no other — no re-derivation, no ambiguity, no "there were
   * three buttons with this name". Tried before every other strategy; if the
   * element is gone the resolver falls through to the semantic hints below and
   * reports the ref as stale rather than binding to the wrong element.
   */
  ref: z.string().regex(/^e\d+$/).optional(),
  /**
   * CSS path of the iframe the element lives in, when it is not in the main
   * frame. Produced by the snapshot; the resolver scopes every strategy to it.
   */
  frame: z.string().optional(),
  /**
   * What the caller believes this element is. Never used to find it — it is
   * recorded on the execution step, and given to the vision fallback as the
   * description to look for when every deterministic strategy has failed.
   */
  elementDescription: z.string().max(200).optional(),
  css: z.string().optional(),
  xpath: z.string().optional(),
  role: z.string().optional(),
  text: z.string().optional(),
  ariaLabel: z.string().optional(),
  nearbyText: z.string().optional(),
  testId: z.string().optional(),
  nth: z.number().int().min(0).optional(),
  /**
   * Only ever bind to elements that are actually visible. Defaults to true.
   * Without this a union selector like "textarea, [contenteditable]" binds to
   * the first DOM match even when it is an offscreen/hidden node, and then
   * waits forever for something that will never become visible.
   */
  visibleOnly: z.boolean().optional(),
  /** Additionally require the element to be editable (inputs/composers). */
  editable: z.boolean().optional(),
  /** Try semantic strategies (role/text/aria-label) before raw CSS. */
  preferSemantic: z.boolean().optional(),
});
export type SelectorTarget = z.infer<typeof selectorTargetSchema>;

export const conditionExpressionSchema = z.object({
  left: z.string(),
  operator: z.enum([
    "equals",
    "notEquals",
    "contains",
    "notContains",
    "greaterThan",
    "lessThan",
    "exists",
    "notExists",
    "isTrue",
    "isFalse",
  ]),
  right: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type ConditionExpression = z.infer<typeof conditionExpressionSchema>;

export const nodeTypeSchema = z.enum(NODE_TYPES);

// Node-type-specific configuration. Kept permissive (passthrough) per type so
// new node types / fields can be added without breaking older documents;
// the automation-engine validates the fields it actually needs at run time.
export const nodeConfigSchema = z
  .object({
    url: z.string().optional(),
    target: selectorTargetSchema.optional(),
    value: z.string().optional(),
    variableName: z.string().optional(),
    variableValue: z.unknown().optional(),
    attribute: z.string().optional(),
    key: z.string().optional(),
    ms: z.number().int().optional(),
    condition: conditionExpressionSchema.optional(),
    trueNodeId: z.string().optional(),
    falseNodeId: z.string().optional(),
    loopCount: z.number().int().optional(),
    forEachVariable: z.string().optional(),
    bodyNodeId: z.string().optional(),
    bodyEndNodeId: z.string().optional(),
    script: z.string().optional(),
    filePath: z.string().optional(),
    downloadDir: z.string().optional(),
    prompt: z.string().optional(),
    allowedTools: z.array(z.string()).optional(),
    approvalMessage: z.string().optional(),
    webhookUrl: z.string().optional(),
    webhookPayload: z.record(z.string(), z.unknown()).optional(),
    errorMessage: z.string().optional(),
    scrollDirection: z.enum(["up", "down", "top", "bottom"]).optional(),
    tabIndex: z.number().int().optional(),
    // PARSE_JSON
    /** Dotted path of the variable holding the text to parse ("planReply.result.text"). */
    sourceVariable: z.string().optional(),
    /** Dotted paths that must exist and be non-empty in the parsed value, or the parse counts as failed. */
    require: z.array(z.string()).optional(),
    // WAIT_FOR_TEXT
    text: z.string().optional(),
    /** Wait for the text to DISAPPEAR rather than appear (spinners, "Saving..."). */
    absent: z.boolean().optional(),
    /**
     * After a mutating action, wait for the page to stop changing before the
     * next observation. Defaults to on; `settle: false` opts a node out.
     */
    settle: z.boolean().optional(),
    settleMs: z.number().int().min(0).max(30_000).optional(),
    // PROBE_PAGE / WAIT_FOR_STATE / FLOW_NAVIGATE
    states: z.array(z.string()).optional(),
    failStates: z.array(z.string()).optional(),
    goalState: z.string().optional(),
    pollMs: z.number().int().min(100).optional(),
    maxSteps: z.number().int().min(1).max(50).optional(),
    maxElements: z.number().int().min(1).max(500).optional(),
    maxTextLength: z.number().int().min(100).max(50_000).optional(),
    screenshotName: z.string().optional(),
    screenshot: z.boolean().optional(),
    requireNewVideo: z.boolean().optional(),
    // FAIL
    errorCode: z.string().optional(),
    category: z.enum(FAILURE_CATEGORIES).optional(),
    retryable: z.boolean().optional(),
  })
  .passthrough();
export type NodeConfig = z.infer<typeof nodeConfigSchema>;

export const workflowNodeSchema = z.object({
  id: z.string().min(1),
  type: nodeTypeSchema,
  name: z.string().min(1),
  config: nodeConfigSchema.default({}),
  next: z.string().nullable().optional(), // default "next node" edge
  timeout: z.number().int().min(0).default(30_000),
  retry: retryPolicySchema.default({ maxRetries: 0, delayMs: 1000, exponentialBackoff: true, maxDelayMs: 30_000 }),
  continueOnError: z.boolean().default(false),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(), // e.g. "yes" / "no" branch label for CONDITION
});
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

export const workflowDefinitionSchema = z.object({
  startNodeId: z.string(),
  nodes: z.array(workflowNodeSchema).min(1),
  edges: z.array(workflowEdgeSchema).default([]),
  variables: z.record(z.string(), z.unknown()).default({}),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export function validateWorkflowDefinition(def: WorkflowDefinition): string[] {
  const errors: string[] = [];
  const ids = new Set(def.nodes.map((n) => n.id));
  if (!ids.has(def.startNodeId)) {
    errors.push(`startNodeId "${def.startNodeId}" does not reference an existing node`);
  }
  for (const node of def.nodes) {
    if (node.next && !ids.has(node.next)) {
      errors.push(`Node "${node.id}" .next references missing node "${node.next}"`);
    }
    if (node.type === "CONDITION") {
      if (node.config.trueNodeId && !ids.has(node.config.trueNodeId)) {
        errors.push(`Node "${node.id}" trueNodeId references missing node`);
      }
      if (node.config.falseNodeId && !ids.has(node.config.falseNodeId)) {
        errors.push(`Node "${node.id}" falseNodeId references missing node`);
      }
    }
    if ((node.type === "LOOP" || node.type === "FOR_EACH") && node.config.bodyNodeId) {
      if (!ids.has(node.config.bodyNodeId)) {
        errors.push(`Node "${node.id}" bodyNodeId references missing node`);
      }
    }
  }
  for (const edge of def.edges) {
    if (!ids.has(edge.source)) errors.push(`Edge "${edge.id}" source missing`);
    if (!ids.has(edge.target)) errors.push(`Edge "${edge.id}" target missing`);
  }
  return errors;
}

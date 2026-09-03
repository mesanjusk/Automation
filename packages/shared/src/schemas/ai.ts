import { z } from "zod";
import { AGENT_TOOLS } from "../enums";

// Strict schema the AI's structured output MUST validate against before any
// tool is executed. Anything that fails this parse is rejected — the AI
// never gets to run arbitrary code or free-form actions.
export const agentTargetSchema = z.object({
  /**
   * The element handle from the snapshot the agent was just shown ("e12").
   *
   * This is how a browser-extension agent stays accurate: it points at an
   * element it actually saw rather than describing one and hoping the
   * description resolves to the same node. The resolver binds refs exactly and
   * only falls back to the hints below when the ref has gone stale.
   */
  ref: z.string().regex(/^e\d+$/).optional(),
  /**
   * What the agent believes it is acting on ("the blue Continue button").
   * Never used to find the element — it is recorded on the execution step so a
   * human reading the run can see intent next to what was really clicked.
   */
  elementDescription: z.string().max(200).optional(),
  /** CSS path of the containing iframe, when the element is not in the main frame. */
  frame: z.string().optional(),
  css: z.string().optional(),
  text: z.string().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  testId: z.string().optional(),
  xpath: z.string().optional(),
  // Locator hints, not new capabilities: they only change which of the
  // strategies above the resolver tries first and which match it binds to.
  /** Index into the match set, for pages that render the same control per row. */
  nth: z.number().int().min(0).max(200).optional(),
  /** Try role/text/aria-label before raw CSS. */
  preferSemantic: z.boolean().optional(),
  /** Additionally require the element to be editable. */
  editable: z.boolean().optional(),
});
export type AgentTarget = z.infer<typeof agentTargetSchema>;

export const agentActionSchema = z.object({
  tool: z.enum(AGENT_TOOLS),
  target: agentTargetSchema.optional(),
  value: z.string().optional(),
  url: z.string().optional(),
  key: z.string().optional(),
  reason: z.string().min(1, "AI must justify every action"),
  /**
   * What the agent expects to be true after this action ("the results table
   * is visible"). Fed back to it next turn alongside what actually changed, so
   * a click that silently did nothing is noticed instead of built upon.
   */
  expectation: z.string().max(300).optional(),
  resultVariable: z.string().optional(),
});
export type AgentAction = z.infer<typeof agentActionSchema>;

/** One interactive control as the agent sees it in a snapshot. */
export const agentSnapshotElementSchema = z.object({
  ref: z.string(),
  role: z.string(),
  name: z.string(),
  tag: z.string().optional(),
  editable: z.boolean().optional(),
  disabled: z.boolean().optional(),
  inViewport: z.boolean().optional(),
  frame: z.string().optional(),
  value: z.string().optional(),
});
export type AgentSnapshotElement = z.infer<typeof agentSnapshotElementSchema>;

export const agentPageSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  visibleText: z.string(),
  /** Ref-labelled outline of every visible control — the agent's primary input. */
  outline: z.string().optional(),
  elements: z.array(agentSnapshotElementSchema).optional(),
  /** Legacy aria outline, kept so older stored contexts still parse. */
  accessibilityTree: z.string().optional(),
  /** Dialogs, alerts, live-region announcements and other things worth reading first. */
  notices: z.array(z.string()).optional(),
  /** Open tabs, so tab-switching tools have something concrete to address. */
  tabs: z.array(z.object({ index: z.number().int(), url: z.string(), title: z.string(), active: z.boolean() })).optional(),
  scroll: z.object({ y: z.number(), height: z.number(), viewport: z.number(), atBottom: z.boolean() }).optional(),
  screenshotFileId: z.string().optional(),
});
export type AgentPageSnapshot = z.infer<typeof agentPageSnapshotSchema>;

/** How the previous action actually turned out — the agent's feedback loop. */
export const agentActionOutcomeSchema = z.object({
  tool: z.string(),
  status: z.enum(["success", "failed"]),
  detail: z.string().optional(),
  /** Human-readable diff between the page before the action and after it. */
  changed: z.string().optional(),
  expectation: z.string().optional(),
});
export type AgentActionOutcome = z.infer<typeof agentActionOutcomeSchema>;

export const agentContextSchema = z.object({
  goal: z.string(),
  page: agentPageSnapshotSchema,
  variables: z.record(z.string(), z.unknown()).default({}),
  previousActions: z.array(agentActionSchema).default([]),
  lastError: z.string().optional(),
  lastOutcome: agentActionOutcomeSchema.optional(),
  actionsSoFar: z.number().int().default(0),
  maxActions: z.number().int().default(100),
  allowedDomains: z.array(z.string()).optional(),
});
export type AgentContext = z.infer<typeof agentContextSchema>;

export const visionTargetResultSchema = z.object({
  found: z.boolean(),
  description: z.string().optional(),
  approxBoxPercent: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type VisionTargetResult = z.infer<typeof visionTargetResultSchema>;

import { z } from "zod";
import { AGENT_TOOLS } from "../enums";

// Strict schema the AI's structured output MUST validate against before any
// tool is executed. Anything that fails this parse is rejected — the AI
// never gets to run arbitrary code or free-form actions.
export const agentTargetSchema = z.object({
  css: z.string().optional(),
  text: z.string().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  testId: z.string().optional(),
  xpath: z.string().optional(),
});
export type AgentTarget = z.infer<typeof agentTargetSchema>;

export const agentActionSchema = z.object({
  tool: z.enum(AGENT_TOOLS),
  target: agentTargetSchema.optional(),
  value: z.string().optional(),
  url: z.string().optional(),
  key: z.string().optional(),
  reason: z.string().min(1, "AI must justify every action"),
  resultVariable: z.string().optional(),
});
export type AgentAction = z.infer<typeof agentActionSchema>;

export const agentPageSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  visibleText: z.string(),
  accessibilityTree: z.string().optional(),
  screenshotFileId: z.string().optional(),
});
export type AgentPageSnapshot = z.infer<typeof agentPageSnapshotSchema>;

export const agentContextSchema = z.object({
  goal: z.string(),
  page: agentPageSnapshotSchema,
  variables: z.record(z.string(), z.unknown()).default({}),
  previousActions: z.array(agentActionSchema).default([]),
  lastError: z.string().optional(),
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

import { z } from "zod";

export const runAutomationRequestSchema = z.object({
  automation: z.string().min(1, "automation slug or id is required"),
  input: z.record(z.string(), z.unknown()).default({}),
  callbackUrl: z.string().url().optional(),
  browserProfileId: z.string().optional(),
  priority: z.number().int().min(1).max(10).optional(),
});
export type RunAutomationRequest = z.infer<typeof runAutomationRequestSchema>;

export const runAutomationResponseSchema = z.object({
  taskId: z.string(),
  status: z.string(),
});
export type RunAutomationResponse = z.infer<typeof runAutomationResponseSchema>;

export const webhookEventSchema = z.object({
  event: z.enum([
    "automation.started",
    "automation.completed",
    "automation.failed",
    "automation.human_intervention_required",
    "automation.cancelled",
  ]),
  automationId: z.string(),
  taskId: z.string(),
  status: z.string(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.record(z.string(), z.unknown()).optional(),
  files: z.array(z.object({ id: z.string(), name: z.string(), url: z.string() })).default([]),
  timestamp: z.string(),
});
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const generateWorkflowRequestSchema = z.object({
  description: z.string().min(10, "Describe what the browser should do in more detail"),
  automationName: z.string().optional(),
});
export type GenerateWorkflowRequest = z.infer<typeof generateWorkflowRequestSchema>;

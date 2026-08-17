import type { Types } from "mongoose";
import type { EngineHooks, HumanApprovalRequest } from "@bos/automation-engine";
import { Execution, ExecutionStep, HumanIntervention, File as FileModel, Task } from "@bos/database";
import { getStorageProvider } from "@bos/storage";
import { enqueueWebhook } from "@bos/queue";
import type { AgentAction } from "@bos/shared";
import { buildAiDecisionHook } from "./aiAgent.js";
import type { BrowserSession } from "@bos/browser";

export function buildEngineHooks(params: {
  taskId: string;
  executionId: Types.ObjectId;
  session: BrowserSession;
  allowedAiDomains?: string[];
}): EngineHooks {
  const { taskId, executionId, session } = params;
  const decideNextAiAction = buildAiDecisionHook(taskId, session, params.allowedAiDomains);

  return {
    async onStepStart(event) {
      console.log(`[task ${taskId}] -> ${event.nodeType} (${event.nodeName})`);
    },

    async onStepComplete(event) {
      let screenshotId: Types.ObjectId | undefined;
      if (event.screenshotBuffer) {
        const storage = getStorageProvider();
        const stored = await storage.upload({
          buffer: event.screenshotBuffer,
          fileName: `${event.stepId}.png`,
          mimeType: "image/png",
          folder: `tasks/${taskId}/screenshots`,
        });
        const fileDoc = await FileModel.create({
          name: `${event.nodeName} screenshot`,
          mimeType: "image/png",
          size: stored.size,
          provider: stored.provider,
          url: stored.url,
          storageKey: stored.storageKey,
          kind: "screenshot",
          taskId,
        });
        screenshotId = fileDoc._id as Types.ObjectId;
      }

      await ExecutionStep.create({
        executionId,
        taskId,
        stepId: event.stepId,
        action: event.nodeType,
        name: event.nodeName,
        status: event.status,
        output: normalizeOutput(event.output),
        error: event.error,
        duration: event.duration,
        selectorStrategyUsed: event.selectorStrategyUsed,
        screenshotId,
      });
    },

    decideNextAiAction: async (goal, variables, previousActions) => {
      return decideNextAiAction(goal, variables, previousActions as AgentAction[]);
    },

    async requestHumanApproval(request: HumanApprovalRequest) {
      const existing = await HumanIntervention.findOne({ taskId, stepId: request.stepId }).sort({ requestedAt: -1 });
      if (existing && existing.status !== "pending") {
        return existing.status === "approved" ? "approved" : "rejected";
      }
      if (existing) return "pending";

      await HumanIntervention.create({
        taskId,
        stepId: request.stepId,
        reason: "APPROVAL",
        message: request.message,
        status: "pending",
      });
      return "pending";
    },

    async deliverWebhook(url, payload) {
      await enqueueWebhook({ webhookUrl: url, payload });
    },

    log(message) {
      console.log(`[task ${taskId}] ${message}`);
    },

    async shouldCancel() {
      const current = await Task.findById(taskId).select("status").lean();
      return current?.status === "CANCELLED";
    },
  };
}

function normalizeOutput(output: unknown): Record<string, unknown> | undefined {
  if (output === undefined) return undefined;
  if (output && typeof output === "object" && !Array.isArray(output)) return output as Record<string, unknown>;
  return { value: output };
}

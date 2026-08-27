import type { Types } from "mongoose";
import type { EngineHooks, HumanApprovalRequest } from "@bos/automation-engine";
import { Execution, ExecutionStep, HumanIntervention, File as FileModel, Task } from "@bos/database";
import { getStorageProvider } from "@bos/storage";
import type { AgentAction } from "@bos/shared";
import { buildAiDecisionHook } from "./aiAgent";
import { deliverWebhook as postWebhook } from "./webhookDelivery";

const WORKER_TARGET = (process.env.WORKER_TARGET || "render").toLowerCase() === "local" ? "local" : "render";
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
      await Task.findByIdAndUpdate(taskId, { currentStepId: event.stepId });
    },

    async onScreenshot(name, buffer, meta) {
      // Named mid-step transitions (flow_landing, flow_generating, ...) get
      // their own dashboard row so a failed run can be read back visually.
      const screenshotId = await storeScreenshot(taskId, name, buffer, name);
      await ExecutionStep.create({
        executionId,
        taskId,
        stepId: name,
        action: "SCREENSHOT",
        name,
        status: "SUCCESS",
        output: meta as Record<string, unknown> | undefined,
        screenshotId,
      });
    },

    async onStepComplete(event) {
      let screenshotId: Types.ObjectId | undefined;
      if (event.screenshotBuffer) {
        screenshotId = await storeScreenshot(taskId, event.stepId, event.screenshotBuffer, `${event.nodeName} screenshot`);
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
      if (WORKER_TARGET === "local") {
        await postWebhook(url, payload);
        return;
      }
      const { enqueueWebhook } = await import("@bos/queue");
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

async function storeScreenshot(
  taskId: string,
  fileStem: string,
  buffer: Buffer,
  displayName: string
): Promise<Types.ObjectId> {
  const storage = getStorageProvider();
  const stored = await storage.upload({
    buffer,
    fileName: `${fileStem}-${Date.now()}.png`,
    mimeType: "image/png",
    folder: `tasks/${taskId}/screenshots`,
  });
  const fileDoc = await FileModel.create({
    name: displayName,
    mimeType: "image/png",
    size: stored.size,
    provider: stored.provider,
    url: stored.url,
    storageKey: stored.storageKey,
    kind: "screenshot",
    taskId,
  });
  return fileDoc._id as Types.ObjectId;
}

function normalizeOutput(output: unknown): Record<string, unknown> | undefined {
  if (output === undefined) return undefined;
  if (output && typeof output === "object" && !Array.isArray(output)) return output as Record<string, unknown>;
  return { value: output };
}

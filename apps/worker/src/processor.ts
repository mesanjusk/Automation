import path from "node:path";
import fs from "node:fs/promises";
import { Task, WorkflowVersion, BrowserProfile, Execution, File as FileModel, Credential } from "@bos/database";
import { decrypt, decryptJSON, encryptJSON } from "@bos/security";
import { BrowserSession } from "@bos/browser";
import { WorkflowEngine } from "@bos/automation-engine";
import { enqueueWebhook } from "@bos/queue";
import type { WebhookEvent, WorkflowDefinition } from "@bos/shared";
import { buildEngineHooks } from "./hooks.js";
import { buildVisualFallback } from "./aiAgent.js";

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;

export async function processTaskJob(taskId: string): Promise<void> {
  const task = await Task.findById(taskId);
  if (!task) {
    console.error(`[worker] Task ${taskId} not found, skipping`);
    return;
  }
  if (task.status === "CANCELLED") {
    console.log(`[worker] Task ${taskId} was cancelled before it started, skipping`);
    return;
  }

  const workflowVersion = await WorkflowVersion.findById(task.workflowVersionId);
  if (!workflowVersion) {
    await failTask(task.id, "WORKFLOW_VERSION_NOT_FOUND", "The workflow version referenced by this task no longer exists.");
    return;
  }
  const definition = workflowVersion.definition as WorkflowDefinition;

  const isResume = task.status === "WAITING_FOR_HUMAN" && !!task.currentStepId;
  const startNodeId = isResume ? (task.currentStepId as string) : definition.startNodeId;
  const initialVariables = isResume ? (task.variables as Record<string, unknown>) : { input: task.input };

  let profile = task.browserProfileId ? await BrowserProfile.findById(task.browserProfileId).select("+encryptedStorageState") : null;

  task.status = isResume ? "RUNNING" : "STARTING";
  task.workerId = WORKER_ID;
  if (!task.startedAt) task.startedAt = new Date();
  await task.save();

  const execution = await Execution.create({ taskId: task.id, attempt: (await Execution.countDocuments({ taskId: task.id })) + 1, workerId: WORKER_ID });

  const downloadDir = path.join(process.env.LOCAL_STORAGE_DIR || "./storage/local", "downloads", String(task.id));
  await fs.mkdir(downloadDir, { recursive: true });

  let session: BrowserSession | null = null;
  try {
    const storageState = profile?.encryptedStorageState ? decryptJSON(profile.encryptedStorageState) : undefined;
    session = await BrowserSession.launch({
      userAgent: profile?.userAgent,
      viewport: profile?.viewport,
      locale: profile?.locale,
      timezone: profile?.timezone,
      storageState,
    });

    task.status = "RUNNING";
    await task.save();

    const hooks = buildEngineHooks({ taskId: task.id, executionId: execution._id, session });
    const engine = new WorkflowEngine({
      definition,
      session,
      hooks,
      downloadDir,
      options: {
        maxAiActions: Number(process.env.MAX_AI_ACTIONS ?? 100),
        allowedAiDomains: process.env.AI_ALLOWED_DOMAINS ? process.env.AI_ALLOWED_DOMAINS.split(",").map((d) => d.trim()) : undefined,
        visualFallback: buildVisualFallback(),
        resolveSecret: buildSecretResolver(profile?.id ? String(profile.id) : undefined),
      },
    });

    const result = await engine.run(startNodeId, initialVariables);

    // Persist browser profile session state (cookies/localStorage) for reuse,
    // regardless of outcome, so a manual login done earlier keeps working.
    if (profile) {
      const newState = await session.exportStorageState();
      profile.encryptedStorageState = encryptJSON(newState);
      profile.status = "ready";
      profile.lastUsedAt = new Date();
      await profile.save();
    }

    if (result.status === "completed") {
      task.status = "COMPLETED";
      task.output = result.variables;
      task.completedAt = new Date();
      task.duration = task.startedAt ? task.completedAt.getTime() - task.startedAt.getTime() : undefined;
      await task.save();
      execution.status = "completed";
      execution.completedAt = new Date();
      await execution.save();
      await sendWebhook(task, "automation.completed", result.variables);
    } else if (result.status === "paused") {
      task.status = "WAITING_FOR_HUMAN";
      task.currentStepId = result.lastNodeId;
      task.variables = result.variables;
      await task.save();
      execution.status = "paused";
      await execution.save();
      await sendWebhook(task, "automation.human_intervention_required", result.variables);
    } else if (result.status === "cancelled") {
      task.status = "CANCELLED";
      task.completedAt = new Date();
      task.duration = task.startedAt ? task.completedAt.getTime() - task.startedAt.getTime() : undefined;
      await task.save();
      execution.status = "failed";
      execution.completedAt = new Date();
      await execution.save();
      await sendWebhook(task, "automation.cancelled", result.variables);
    } else {
      task.status = "FAILED";
      task.error = result.error as Record<string, unknown>;
      task.completedAt = new Date();
      task.duration = task.startedAt ? task.completedAt.getTime() - task.startedAt.getTime() : undefined;
      await task.save();
      execution.status = "failed";
      execution.completedAt = new Date();
      await execution.save();
      await sendWebhook(task, "automation.failed", undefined, result.error as Record<string, unknown>);
    }
  } catch (err) {
    console.error(`[worker] Unhandled error running task ${taskId}:`, err);
    task.status = "FAILED";
    task.error = { message: (err as Error).message, category: "PERMANENT", retryable: false };
    task.completedAt = new Date();
    await task.save();
    execution.status = "failed";
    execution.completedAt = new Date();
    await execution.save();
    await sendWebhook(task, "automation.failed", undefined, task.error);
  } finally {
    if (session) await session.close();
  }
}

async function failTask(taskId: string, code: string, message: string): Promise<void> {
  await Task.findByIdAndUpdate(taskId, {
    status: "FAILED",
    error: { errorCode: code, message, retryable: false },
    completedAt: new Date(),
  });
}

async function sendWebhook(
  task: InstanceType<typeof Task>,
  event: WebhookEvent["event"],
  result?: Record<string, unknown>,
  error?: Record<string, unknown>
): Promise<void> {
  if (!task.callbackUrl) return;
  const files = await FileModel.find({ taskId: task.id }).select("_id name url").lean();
  const payload: WebhookEvent = {
    event,
    automationId: String(task.automationId),
    taskId: String(task.id),
    status: task.status,
    result,
    error,
    files: files.map((f) => ({ id: String(f._id), name: f.name, url: f.url })),
    timestamp: new Date().toISOString(),
  };
  await enqueueWebhook({ webhookUrl: task.callbackUrl, payload });
}

/**
 * Resolves {{secret:credentialName}} tokens for the browser executor.
 * Decrypts just-in-time and returns the plaintext directly to Playwright —
 * it is never written into engine variables, so it can't leak into an AI
 * prompt, an ExecutionStep log, or a webhook payload.
 */
function buildSecretResolver(browserProfileId?: string) {
  return async (name: string): Promise<string | undefined> => {
    const query: Record<string, unknown> = { name };
    if (browserProfileId) query.browserProfileId = browserProfileId;
    const credential = await Credential.findOne(query).select("+encryptedValue");
    if (!credential) return undefined;
    return decrypt(credential.encryptedValue);
  };
}

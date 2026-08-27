import path from "node:path";
import fs from "node:fs/promises";
import { Task, WorkflowVersion, BrowserProfile, Execution, File as FileModel, Credential, Webhook } from "@bos/database";
import { decrypt, decryptJSON, encryptJSON } from "@bos/security";
import { BrowserSession } from "@bos/browser";
import { WorkflowEngine } from "@bos/automation-engine";
import { enqueueWebhook } from "@bos/queue";
import type { WebhookEvent, WorkflowDefinition } from "@bos/shared";
import { buildEngineHooks } from "./hooks";
import { buildVisualFallback } from "./aiAgent";

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;

export async function processTaskJob(taskId: string): Promise<void> {
  const task = await Task.findById(taskId);
  if (!task) { console.error(`[worker] Task ${taskId} not found, skipping`); return; }
  if (task.status === "CANCELLED") { console.log(`[worker] Task ${taskId} was cancelled before it started, skipping`); return; }
  const workflowVersion = await WorkflowVersion.findById(task.workflowVersionId);
  if (!workflowVersion) { await failTask(task.id, "WORKFLOW_VERSION_NOT_FOUND", "The workflow version referenced by this task no longer exists."); return; }
  const definition = workflowVersion.definition as WorkflowDefinition;
  const isResume = task.status === "WAITING_FOR_HUMAN" && !!task.currentStepId;
  const startNodeId = isResume ? (task.currentStepId as string) : definition.startNodeId;
  const taskInput = (task.input || {}) as Record<string, unknown>;
  const initialVariables = isResume ? (task.variables as Record<string, unknown>) : { input: taskInput, ...taskInput };
  let profile = task.browserProfileId ? await BrowserProfile.findById(task.browserProfileId).select("+encryptedStorageState") : null;
  task.status = isResume ? "RUNNING" : "STARTING"; task.workerId = WORKER_ID; if (!task.startedAt) task.startedAt = new Date(); await task.save();
  const execution = await Execution.create({ taskId: task.id, attempt: (await Execution.countDocuments({ taskId: task.id })) + 1, workerId: WORKER_ID });
  const downloadDir = path.join(process.env.LOCAL_STORAGE_DIR || "./storage/local", "downloads", String(task.id)); await fs.mkdir(downloadDir, { recursive: true });
  let session: BrowserSession | null = null;
  try {
    const storageState = profile?.encryptedStorageState ? decryptJSON(profile.encryptedStorageState) : undefined;
    session = await BrowserSession.launch({ userAgent: profile?.userAgent, viewport: profile?.viewport, locale: profile?.locale, timezone: profile?.timezone, storageState });
    task.status = "RUNNING"; await task.save();
    const engine = new WorkflowEngine({ definition, session, downloadDir, hooks: buildEngineHooks(task, execution), options: { visualFallback: buildVisualFallback(), resolveSecret: async (name: string) => { const credential = await Credential.findOne({ name, status: "active" }).select("+encryptedValue"); return credential?.encryptedValue ? decrypt(credential.encryptedValue) : undefined; } } });
    const result = await engine.run(startNodeId, initialVariables);
    task.variables = result.variables;
    if (result.status === "completed") { task.status = "COMPLETED"; task.completedAt = new Date(); task.output = result.variables; }
    else if (result.status === "cancelled") { task.status = "CANCELLED"; task.completedAt = new Date(); }
    else if (result.status === "paused") { task.status = "WAITING_FOR_HUMAN"; task.currentStepId = result.lastNodeId; }
    else { task.status = "FAILED"; task.completedAt = new Date(); task.error = result.error; }
    if (task.startedAt && task.completedAt) task.duration = task.completedAt.getTime() - task.startedAt.getTime(); await task.save();
    execution.status = task.status === "COMPLETED" ? "COMPLETED" : task.status === "FAILED" ? "FAILED" : task.status === "CANCELLED" ? "CANCELLED" : "RUNNING"; execution.completedAt = task.completedAt; execution.output = result.variables; if (result.error) execution.error = result.error; await execution.save();
    if (task.callbackUrl && ["COMPLETED","FAILED","CANCELLED"].includes(task.status)) await enqueueWebhook(task.callbackUrl, { taskId: String(task.id), status: task.status, output: task.output, error: task.error }, undefined);
  } catch (err) { console.error(`[worker] task ${task.id} crashed:`, err); await failTask(task.id, "WORKER_ERROR", (err as Error).message); execution.status = "FAILED"; execution.error = { message: (err as Error).message }; execution.completedAt = new Date(); await execution.save(); }
  finally { if (session) { try { if (profile) { const state = await session.exportStorageState(); profile.encryptedStorageState = encryptJSON(state); profile.lastUsedAt = new Date(); await profile.save(); } } catch (e) { console.error("[worker] failed to persist browser profile:", e); } await session.close(); } }
}

async function failTask(taskId: string, category: string, message: string) { await Task.findByIdAndUpdate(taskId, { status: "FAILED", completedAt: new Date(), error: { category, message } }); }

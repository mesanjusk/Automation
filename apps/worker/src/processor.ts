import path from "node:path";
import fs from "node:fs/promises";
import { Task, WorkflowVersion, BrowserProfile, Execution, Credential } from "@bos/database";
import { decrypt, decryptJSON, encryptJSON } from "@bos/security";
import { BrowserSession } from "@bos/browser";
import { WorkflowEngine } from "@bos/automation-engine";
import type { WorkflowDefinition } from "@bos/shared";
import { buildEngineHooks } from "./hooks";
import { buildVisualFallback } from "./aiAgent";
import { deliverWebhook } from "./webhookDelivery";
import { buildTerminalHumanGate } from "./humanGate";

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
  const browserAgentMode = taskInput.browserAgentMode === "chatgpt-web" ? "chatgpt-web" as const : undefined;
  const initialVariables = isResume ? (task.variables as Record<string, unknown>) : { input: taskInput, ...taskInput };
  const profile = task.browserProfileId ? await BrowserProfile.findById(task.browserProfileId).select("+encryptedStorageState") : null;
  task.status = isResume ? "RUNNING" : "STARTING"; task.workerId = WORKER_ID; if (!task.startedAt) task.startedAt = new Date(); await task.save();
  const execution = await Execution.create({ taskId: task._id, attempt: (await Execution.countDocuments({ taskId: task._id })) + 1, workerId: WORKER_ID });
  const downloadDir = path.join(process.env.LOCAL_STORAGE_DIR || "./storage/local", "downloads", String(task._id)); await fs.mkdir(downloadDir, { recursive: true });
  let session: BrowserSession | null = null;
  try {
    // BROWSER_CDP_URL attaches to a Chrome the person already started and
    // signed in to, instead of launching a fresh one. That is what makes
    // Google Flow reachable at all: Google refuses its sign-in flow inside an
    // automated browser ("this browser or app may not be secure"), so the
    // sign-in happens in their own Chrome and the run joins it afterwards.
    // The stored profile state is not injected in that mode — the live browser
    // already holds the real session, and there is no blank context to seed.
    const cdpUrl = process.env.BROWSER_CDP_URL?.trim();
    if (cdpUrl) {
      console.log(`[worker] attaching to the Chrome already running at ${cdpUrl} — no new browser will be opened.`);
      session = await BrowserSession.connect(cdpUrl);
    } else {
      // Say which browser this run is using, and how to change it. Without
      // this the two modes are indistinguishable from the outside: a fresh
      // window appears either way, and "why did it open a new browser?" has no
      // answer anywhere in the logs.
      console.log(
        "[worker] BROWSER_CDP_URL is not set — launching a new browser for this run. " +
          "To use a Chrome you signed in to yourself, run `npm run chrome` and set BROWSER_CDP_URL to the URL it prints."
      );
      const storageState = profile?.encryptedStorageState ? decryptJSON(profile.encryptedStorageState) : undefined;
      session = await BrowserSession.launch({ userAgent: profile?.userAgent, viewport: profile?.viewport, locale: profile?.locale, timezone: profile?.timezone, storageState });
    }
    task.status = "RUNNING"; await task.save();
    const hooks = buildEngineHooks({ taskId: String(task._id), executionId: execution._id, session, browserAgentMode });
    const engine = new WorkflowEngine({
      definition,
      session,
      downloadDir,
      hooks,
      options: {
        // Video Studio's adaptive agent reasons through the logged-in ChatGPT
        // website. Do not silently fall back to a paid Gemini vision/API call.
        visualFallback: browserAgentMode === "chatgpt-web" ? undefined : buildVisualFallback(),
        maxAiActions: browserAgentMode === "chatgpt-web" ? Number(process.env.BROWSER_AGENT_MAX_ACTIONS || 150) : undefined,
        // WAIT_FOR_LOGIN asks at the worker's terminal and holds the browser
        // open while a person signs in — no password ever passes through here.
        confirmWithHuman: buildTerminalHumanGate(),
        resolveSecret: async (name: string) => {
          const credential = await Credential.findOne({ name, status: "active" }).select("+encryptedValue");
          return credential?.encryptedValue ? decrypt(credential.encryptedValue) : undefined;
        },
      },
    });
    const result = await engine.run(startNodeId, initialVariables);
    task.variables = result.variables;
    if (result.status === "completed") { task.status = "COMPLETED"; task.completedAt = new Date(); task.output = result.variables; }
    else if (result.status === "cancelled") { task.status = "CANCELLED"; task.completedAt = new Date(); }
    else if (result.status === "paused") { task.status = "WAITING_FOR_HUMAN"; task.currentStepId = result.lastNodeId; }
    else { task.status = "FAILED"; task.completedAt = new Date(); task.error = result.error; }
    if (task.startedAt && task.completedAt) task.duration = task.completedAt.getTime() - task.startedAt.getTime(); await task.save();
    execution.status = task.status === "COMPLETED" ? "completed" : task.status === "FAILED" ? "failed" : task.status === "CANCELLED" ? "failed" : "running"; execution.completedAt = task.completedAt; await execution.save();
    if (task.callbackUrl && ["COMPLETED","FAILED","CANCELLED"].includes(task.status)) {
      await notifyCallback(task.callbackUrl, { taskId: String(task.id), status: task.status, output: task.output, error: task.error }, taskInput);
    }
  } catch (err) { console.error(`[worker] task ${task.id} crashed:`, err); await failTask(task.id, "WORKER_ERROR", (err as Error).message); execution.status = "failed"; execution.completedAt = new Date(); await execution.save(); }
  finally { if (session) { try { if (profile) { const state = await session.exportStorageState(); profile.encryptedStorageState = encryptJSON(state); profile.lastUsedAt = new Date(); await profile.save(); } } catch (e) { console.error("[worker] failed to persist browser profile:", e); } await session.close(); } }
}

/**
 * Render tasks hand the callback to the webhook queue (retries, backoff).
 * Local tasks have no Redis, so they post it directly — a failed post must not
 * fail an otherwise-finished video.
 */
async function notifyCallback(url: string, payload: Record<string, unknown>, taskInput: Record<string, unknown>) {
  try {
    if (taskInput.executionTarget === "local") {
      await deliverWebhook(url, payload);
      return;
    }
    const { enqueueWebhook } = await import("@bos/queue");
    await enqueueWebhook({ webhookUrl: url, payload });
  } catch (err) {
    console.error(`[worker] callback delivery to ${url} failed:`, (err as Error).message);
  }
}

async function failTask(taskId: string, category: string, message: string) { await Task.findByIdAndUpdate(taskId, { status: "FAILED", completedAt: new Date(), error: { category, message } }); }

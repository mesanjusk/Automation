"use server";

import { revalidatePath } from "next/cache";
import { dbConnect } from "@/lib/db";
import { Task, HumanIntervention, Workflow, WorkflowVersion } from "@bos/database";
import { dispatchTask } from "@/lib/dispatch";
import { regenerateDefinition } from "@/lib/workflowGenerators";

export async function cancelTask(taskId: string) {
  await dbConnect();
  await Task.findByIdAndUpdate(taskId, { status: "CANCELLED", completedAt: new Date() });
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");
}

export async function resumeTask(taskId: string) {
  await dbConnect();
  const task = await Task.findById(taskId);
  if (!task) throw new Error("Task not found");
  if (task.status !== "WAITING_FOR_HUMAN") throw new Error("Task is not waiting for human input");
  await dispatchTask(taskId, { priority: 1 });
  revalidatePath(`/tasks/${taskId}`);
}

/**
 * Re-runs a task.
 *
 * A hand-built workflow is replayed at exactly the version that ran, which is
 * the point of versioning them. A code-generated one is rebuilt from the
 * current source first: its stored version is only a snapshot of what the
 * generator emitted when the run started, so replaying it pins every retry to
 * that day's code — which is how a bug that was fixed and merged can keep
 * reappearing, with its original error message, on every retry of an old task.
 */
async function versionForRetry(workflowId: unknown, storedVersionId: unknown): Promise<unknown> {
  const workflow = await Workflow.findById(workflowId as string);
  const definition = regenerateDefinition(workflow?.generator);
  if (!workflow || !definition) return storedVersionId;

  const version = (workflow.currentVersion ?? 0) + 1;
  const fresh = await WorkflowVersion.create({
    workflowId: workflow._id,
    version,
    definition,
    publishedAt: new Date(),
    notes: `Regenerated from the ${workflow.generator} generator for a retry`,
  });
  workflow.currentVersion = version;
  workflow.publishedVersionId = fresh._id as never;
  await workflow.save();
  return fresh._id;
}

export async function retryTask(taskId: string) {
  await dbConnect();
  const original = await Task.findById(taskId).lean();
  if (!original) throw new Error("Task not found");
  const workflowVersionId = await versionForRetry(original.workflowId, original.workflowVersionId);
  const retryTask = await Task.create({
    automationId: original.automationId,
    workflowId: original.workflowId,
    workflowVersionId,
    status: "QUEUED",
    input: original.input,
    browserProfileId: original.browserProfileId,
    callbackUrl: original.callbackUrl,
    source: original.source,
    retryCount: (original.retryCount ?? 0) + 1,
  });
  await dispatchTask(String(retryTask._id));
  revalidatePath("/tasks");
  return String(retryTask._id);
}

export async function resolveHumanIntervention(interventionId: string, decision: "approved" | "rejected") {
  await dbConnect();
  const intervention = await HumanIntervention.findById(interventionId);
  if (!intervention) throw new Error("Intervention not found");
  intervention.status = decision;
  intervention.resolvedAt = new Date();
  await intervention.save();

  // Re-queue the task so the engine re-enters the HUMAN_APPROVAL node, sees
  // the now-resolved decision, and continues (or branches on rejection).
  await dispatchTask(String(intervention.taskId), { priority: 1 });
  revalidatePath(`/tasks/${intervention.taskId}`);
}

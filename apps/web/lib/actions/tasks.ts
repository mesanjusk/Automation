"use server";

import { revalidatePath } from "next/cache";
import { dbConnect } from "@/lib/db";
import { Task, HumanIntervention } from "@bos/database";
import { enqueueAutomationTask } from "@bos/queue";

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
  await enqueueAutomationTask(taskId, { priority: 1 });
  revalidatePath(`/tasks/${taskId}`);
}

export async function retryTask(taskId: string) {
  await dbConnect();
  const original = await Task.findById(taskId).lean();
  if (!original) throw new Error("Task not found");
  const retryTask = await Task.create({
    automationId: original.automationId,
    workflowId: original.workflowId,
    workflowVersionId: original.workflowVersionId,
    status: "QUEUED",
    input: original.input,
    browserProfileId: original.browserProfileId,
    callbackUrl: original.callbackUrl,
    source: original.source,
    retryCount: (original.retryCount ?? 0) + 1,
  });
  await enqueueAutomationTask(String(retryTask._id));
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
  await enqueueAutomationTask(String(intervention.taskId), { priority: 1 });
  revalidatePath(`/tasks/${intervention.taskId}`);
}

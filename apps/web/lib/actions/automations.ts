"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbConnect } from "@/lib/db";
import { Automation, Task, Workflow, WorkflowVersion } from "@bos/database";
import { enqueueAutomationTask } from "@bos/queue";

export async function createAutomation(formData: FormData) {
  await dbConnect();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const workflowId = String(formData.get("workflowId") ?? "");
  const browserProfileId = String(formData.get("browserProfileId") ?? "") || undefined;
  const callbackUrl = String(formData.get("callbackUrl") ?? "") || undefined;
  if (!name || !workflowId) throw new Error("Name and workflow are required");

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const automation = await Automation.create({
    name,
    description,
    slug: `${slug}-${Date.now().toString(36)}`,
    workflowId,
    browserProfileId,
    callbackUrl,
    status: "active",
    enabled: true,
  });

  revalidatePath("/automations");
  redirect(`/automations/${automation._id}`);
}

export async function updateAutomation(automationId: string, formData: FormData) {
  await dbConnect();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const callbackUrl = String(formData.get("callbackUrl") ?? "") || undefined;
  const browserProfileId = String(formData.get("browserProfileId") ?? "") || undefined;
  if (!name) throw new Error("Name is required");

  await Automation.findByIdAndUpdate(automationId, { name, description, callbackUrl, browserProfileId });
  revalidatePath(`/automations/${automationId}`);
}

export async function toggleAutomationEnabled(automationId: string, enabled: boolean) {
  await dbConnect();
  await Automation.findByIdAndUpdate(automationId, { enabled, status: enabled ? "active" : "disabled" });
  revalidatePath("/automations");
  revalidatePath(`/automations/${automationId}`);
}

export async function duplicateAutomation(automationId: string) {
  await dbConnect();
  const original = await Automation.findById(automationId).lean();
  if (!original) throw new Error("Automation not found");
  const copy = await Automation.create({
    ...original,
    _id: undefined,
    name: `${original.name} (copy)`,
    slug: `${original.slug}-copy-${Date.now().toString(36)}`,
    createdAt: undefined,
    updatedAt: undefined,
  });
  revalidatePath("/automations");
  redirect(`/automations/${copy._id}`);
}

export async function runAutomationNow(automationId: string, input: Record<string, unknown> = {}) {
  await dbConnect();
  const automation = await Automation.findById(automationId);
  if (!automation) throw new Error("Automation not found");
  const workflow = await Workflow.findById(automation.workflowId);
  if (!workflow?.publishedVersionId) {
    throw new Error("This automation's workflow has no published version yet. Publish the workflow first.");
  }

  const task = await Task.create({
    automationId: automation._id,
    workflowId: workflow._id,
    workflowVersionId: workflow.publishedVersionId,
    status: "QUEUED",
    input,
    browserProfileId: automation.browserProfileId,
    callbackUrl: automation.callbackUrl,
    source: "dashboard",
  });

  await enqueueAutomationTask(String(task._id));
  revalidatePath(`/automations/${automationId}`);
  revalidatePath("/tasks");
  return String(task._id);
}

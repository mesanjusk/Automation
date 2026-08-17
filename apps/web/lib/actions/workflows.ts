"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbConnect } from "@/lib/db";
import { Workflow, WorkflowVersion } from "@bos/database";
import { validateWorkflowDefinition, workflowDefinitionSchema, type WorkflowDefinition } from "@bos/shared";
import { getDefaultLLMProvider } from "@bos/ai";

const EMPTY_DEFINITION: WorkflowDefinition = {
  startNodeId: "start",
  nodes: [{ id: "start", type: "NAVIGATE", name: "Open website", config: { url: "https://example.com" }, next: "end", timeout: 30000, retry: { maxRetries: 1, delayMs: 1000, exponentialBackoff: true, maxDelayMs: 30000 }, continueOnError: false }, { id: "end", type: "END", name: "Done", config: {}, timeout: 0, retry: { maxRetries: 0, delayMs: 0, exponentialBackoff: false, maxDelayMs: 0 }, continueOnError: false }],
  edges: [],
  variables: {},
};

export async function createWorkflow(formData: FormData) {
  await dbConnect();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) throw new Error("Name is required");

  const workflow = await Workflow.create({ name, description, status: "draft", currentVersion: 1 });
  await WorkflowVersion.create({ workflowId: workflow._id, version: 1, definition: EMPTY_DEFINITION });

  revalidatePath("/workflows");
  redirect(`/workflows/${workflow._id}`);
}

export async function saveWorkflowDraft(workflowId: string, definition: WorkflowDefinition, notes?: string) {
  await dbConnect();
  const parsed = workflowDefinitionSchema.parse(definition);
  const errors = validateWorkflowDefinition(parsed);
  if (errors.length) throw new Error(`Workflow validation failed: ${errors.join("; ")}`);

  const workflow = await Workflow.findById(workflowId);
  if (!workflow) throw new Error("Workflow not found");

  const nextVersion = workflow.currentVersion + 1;
  await WorkflowVersion.create({ workflowId, version: nextVersion, definition: parsed, notes });
  workflow.currentVersion = nextVersion;
  await workflow.save();

  revalidatePath(`/workflows/${workflowId}`);
  return nextVersion;
}

export async function publishWorkflowVersion(workflowId: string, version: number) {
  await dbConnect();
  const versionDoc = await WorkflowVersion.findOne({ workflowId, version });
  if (!versionDoc) throw new Error("Workflow version not found");
  versionDoc.publishedAt = new Date();
  await versionDoc.save();

  await Workflow.findByIdAndUpdate(workflowId, { status: "published", publishedVersionId: versionDoc._id });
  revalidatePath(`/workflows/${workflowId}`);
}

/**
 * AI draft generation. Returns the draft for the UI to render for review —
 * it is NEVER saved or run automatically. The user must explicitly click
 * "Save" (saveWorkflowDraft) after reviewing/editing it.
 */
export async function generateWorkflowDraftFromDescription(description: string): Promise<WorkflowDefinition> {
  const provider = getDefaultLLMProvider();
  const { definition } = await provider.generateWorkflowDraft(description);
  return definition;
}

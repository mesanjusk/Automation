import { notFound } from "next/navigation";
import { dbConnect } from "@/lib/db";
import { Workflow, WorkflowVersion } from "@bos/database";
import { WorkflowBuilder } from "@/components/workflow-builder";
import type { WorkflowDefinition } from "@bos/shared";

export const dynamic = "force-dynamic";

export default async function WorkflowDetailPage({ params }: { params: { id: string } }) {
  await dbConnect();
  const workflow = await Workflow.findById(params.id).lean();
  if (!workflow) notFound();

  const [latestVersion, publishedVersion] = await Promise.all([
    WorkflowVersion.findOne({ workflowId: params.id }).sort({ version: -1 }).lean(),
    workflow.publishedVersionId ? WorkflowVersion.findById(workflow.publishedVersionId).lean() : null,
  ]);

  const definition = (latestVersion?.definition ?? { startNodeId: "start", nodes: [], edges: [], variables: {} }) as WorkflowDefinition;

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{workflow.name}</h1>
        <p className="text-sm text-muted-foreground">{workflow.description || "No description"}</p>
      </div>
      <WorkflowBuilder
        workflowId={params.id}
        initialDefinition={definition}
        currentVersion={workflow.currentVersion}
        publishedVersion={publishedVersion?.version}
      />
    </div>
  );
}

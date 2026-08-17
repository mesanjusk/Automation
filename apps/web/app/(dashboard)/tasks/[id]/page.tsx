import { notFound } from "next/navigation";
import { dbConnect } from "@/lib/db";
import { Task, ExecutionStep, HumanIntervention } from "@bos/database";
import { TaskLiveView } from "@/components/task-live-view";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({ params }: { params: { id: string } }) {
  await dbConnect();
  const task = await Task.findById(params.id).populate("automationId", "name").lean();
  if (!task) notFound();

  const [steps, intervention] = await Promise.all([
    ExecutionStep.find({ taskId: params.id }).sort({ timestamp: 1 }).populate("screenshotId", "url").lean(),
    HumanIntervention.findOne({ taskId: params.id, status: "pending" }).lean(),
  ]);

  return (
    <TaskLiveView
      taskId={params.id}
      initialTask={JSON.parse(JSON.stringify(task))}
      initialSteps={JSON.parse(JSON.stringify(steps))}
      initialIntervention={intervention ? JSON.parse(JSON.stringify(intervention)) : null}
    />
  );
}

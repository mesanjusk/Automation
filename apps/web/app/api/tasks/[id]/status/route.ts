import { NextResponse } from "next/server";
import { requireSession } from "@/lib/requireSession";
import { dbConnect } from "@/lib/db";
import { Task, ExecutionStep, HumanIntervention } from "@bos/database";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  await dbConnect();
  const task = await Task.findById(params.id).populate("automationId", "name").lean();
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const [steps, intervention] = await Promise.all([
    ExecutionStep.find({ taskId: params.id }).sort({ timestamp: 1 }).populate("screenshotId", "url").lean(),
    HumanIntervention.findOne({ taskId: params.id, status: "pending" }).lean(),
  ]);

  return NextResponse.json({
    task: JSON.parse(JSON.stringify(task)),
    steps: JSON.parse(JSON.stringify(steps)),
    pendingIntervention: intervention ? JSON.parse(JSON.stringify(intervention)) : null,
  });
}

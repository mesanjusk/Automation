import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";
import { dbConnect } from "@/lib/db";
import { Task, File as FileModel } from "@bos/database";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return auth.error;

  await dbConnect();
  const task = await Task.findById(params.id).lean();
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const files = await FileModel.find({ taskId: params.id }).select("name url kind").lean();

  return NextResponse.json({
    taskId: String(task._id),
    automationId: String(task.automationId),
    status: task.status,
    input: task.input,
    output: task.output,
    error: task.error,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    duration: task.duration,
    retryCount: task.retryCount,
    files: files.map((f) => ({ id: String(f._id), name: f.name, url: f.url, kind: f.kind })),
  });
}

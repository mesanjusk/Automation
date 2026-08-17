import { NextResponse } from "next/server";
import { authenticateApiRequest, auditApiAction } from "@/lib/apiAuth";
import { dbConnect } from "@/lib/db";
import { Task } from "@bos/database";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return auth.error;

  await dbConnect();
  const task = await Task.findById(params.id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) {
    return NextResponse.json({ error: `Task is already ${task.status}` }, { status: 409 });
  }

  task.status = "CANCELLED";
  task.completedAt = new Date();
  await task.save();
  await auditApiAction(auth.ctx.apiKeyId, "tasks.cancel", "Task", params.id);

  return NextResponse.json({ taskId: params.id, status: task.status });
}

import { NextResponse } from "next/server";
import { authenticateApiRequest, auditApiAction } from "@/lib/apiAuth";
import { dbConnect } from "@/lib/db";
import { Task } from "@bos/database";
import { dispatchTask } from "@/lib/dispatch";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return auth.error;

  await dbConnect();
  const task = await Task.findById(params.id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (task.status !== "WAITING_FOR_HUMAN") {
    return NextResponse.json({ error: `Task is not waiting for human input (status: ${task.status})` }, { status: 409 });
  }

  await dispatchTask(params.id, { priority: 1 });
  await auditApiAction(auth.ctx.apiKeyId, "tasks.resume", "Task", params.id);

  return NextResponse.json({ taskId: params.id, status: task.status });
}

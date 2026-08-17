import { NextResponse } from "next/server";
import { authenticateApiRequest, auditApiAction } from "@/lib/apiAuth";
import { dbConnect } from "@/lib/db";
import { Automation, Workflow, Task } from "@bos/database";
import { enqueueAutomationTask } from "@bos/queue";
import { runAutomationRequestSchema } from "@bos/shared";

export async function POST(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = runAutomationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const { automation: automationRef, input, callbackUrl, browserProfileId, priority } = parsed.data;

  await dbConnect();
  const automation = await Automation.findOne({ $or: [{ slug: automationRef }, { _id: isObjectId(automationRef) ? automationRef : undefined }] });
  if (!automation || !automation.enabled) {
    return NextResponse.json({ error: `Automation "${automationRef}" not found or disabled` }, { status: 404 });
  }

  const workflow = await Workflow.findById(automation.workflowId);
  if (!workflow?.publishedVersionId) {
    return NextResponse.json({ error: "This automation's workflow has no published version" }, { status: 409 });
  }

  const task = await Task.create({
    automationId: automation._id,
    workflowId: workflow._id,
    workflowVersionId: workflow.publishedVersionId,
    status: "QUEUED",
    input,
    browserProfileId: browserProfileId || automation.browserProfileId,
    callbackUrl: callbackUrl || automation.callbackUrl,
    priority: priority ?? 5,
    source: "api",
  });

  await enqueueAutomationTask(String(task._id), { priority });
  await auditApiAction(auth.ctx.apiKeyId, "automations.run", "Task", String(task._id));

  return NextResponse.json({ taskId: String(task._id), status: task.status }, { status: 202 });
}

function isObjectId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value);
}

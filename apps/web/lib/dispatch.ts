import { Task } from "@bos/database";

export type ExecutionTarget = "render" | "local";

/**
 * Reads the execution target off a task's input. Video Studio jobs carry
 * `executionTarget: "local"` so they run on the Windows worker against the
 * user's logged-in ChatGPT/Flow sessions.
 */
export function targetOf(input: unknown): ExecutionTarget {
  const value = (input as Record<string, unknown> | null | undefined)?.executionTarget;
  return value === "local" ? "local" : "render";
}

/**
 * Queues a task for whichever worker owns it.
 *
 * Local tasks are picked up by the worker's MongoDB poll, so they need no
 * Redis and no BullMQ. Importing @bos/queue at module scope would drag bullmq
 * (and its optional @valkey/valkey-glide backend) into the Next.js server
 * bundle for every dashboard action, which is where the build warnings came
 * from — so the import happens here, lazily, and only on the Render path.
 */
export async function dispatchTask(
  taskId: string,
  opts: { priority?: number; delay?: number; target?: ExecutionTarget } = {}
): Promise<ExecutionTarget> {
  let target = opts.target;
  if (!target) {
    const task = await Task.findById(taskId).select("input").lean();
    target = targetOf(task?.input);
  }

  if (target === "local") {
    // Hand it back to the local dispatcher: QUEUED with no owning worker is
    // exactly what its findOneAndUpdate claim looks for.
    await Task.updateOne({ _id: taskId }, { $set: { status: "QUEUED" }, $unset: { workerId: "" } });
    return "local";
  }

  const { enqueueAutomationTask } = await import("@bos/queue");
  await enqueueAutomationTask(taskId, { priority: opts.priority, delay: opts.delay, target });
  return "render";
}

import "dotenv/config";
import type { Worker } from "bullmq";
import { connectToDatabase, Task } from "@bos/database";
import type { AutomationTaskJobData, WebhookJobData } from "@bos/queue";
import { QUEUE_NAMES } from "@bos/shared";
import { processTaskJob } from "./processor";
import { deliverWebhook } from "./webhookDelivery";
import { startHealthServer } from "./health";
import { startScheduler } from "./scheduler";

const WORKER_TARGET = (process.env.WORKER_TARGET || "render").toLowerCase() === "local" ? "local" : "render";
const WORKER_ID = process.env.WORKER_ID || `${WORKER_TARGET}-worker-${process.pid}`;
const CONCURRENCY = Number(process.env.BROWSER_MAX_CONCURRENCY ?? (WORKER_TARGET === "local" ? 1 : 3));
const LOCAL_POLL_MS = Number(process.env.LOCAL_POLL_MS ?? 2000);

async function startLocalMongoDispatcher() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const task = await Task.findOneAndUpdate(
        { status: "QUEUED", "input.executionTarget": "local", workerId: { $exists: false } },
        { $set: { status: "STARTING", workerId: WORKER_ID, startedAt: new Date() } },
        { sort: { priority: -1, createdAt: 1 }, new: true }
      );
      if (task) {
        console.log(`[worker ${WORKER_ID}] claimed local task ${task.id} from MongoDB`);
        await processTaskJob(String(task.id));
      }
    } catch (err) {
      console.error(`[worker ${WORKER_ID}] local MongoDB dispatcher error:`, err);
    } finally {
      busy = false;
    }
  };
  await tick();
  return setInterval(() => void tick(), LOCAL_POLL_MS);
}

async function main() {
  await connectToDatabase();
  console.log(`[worker ${WORKER_ID}] connected to MongoDB`);
  const httpServer = startHealthServer(Number(process.env.PORT ?? process.env.WORKER_PORT ?? 4000), WORKER_ID, WORKER_TARGET);

  let taskWorker: Worker<AutomationTaskJobData> | undefined;
  let webhookWorker: Worker<WebhookJobData> | undefined;
  let schedulerTimer: NodeJS.Timeout | undefined;
  let localPollTimer: NodeJS.Timeout | undefined;

  if (WORKER_TARGET === "local") {
    localPollTimer = await startLocalMongoDispatcher();
    console.log(`[worker ${WORKER_ID}] polling MongoDB for local tasks every ${LOCAL_POLL_MS}ms (Redis not required)`);
  } else {
    // bullmq / ioredis are pulled in only here: a WORKER_TARGET=local machine
    // never needs Redis installed, reachable, or even configured.
    const { Worker: BullWorker } = await import("bullmq");
    const { getRedisConnection } = await import("@bos/queue");
    const connection = getRedisConnection();
    taskWorker = new BullWorker<AutomationTaskJobData>(QUEUE_NAMES.automationTasks, async (job) => { await processTaskJob(job.data.taskId); }, { connection, concurrency: CONCURRENCY });
    webhookWorker = new BullWorker<WebhookJobData>(QUEUE_NAMES.webhooks, async (job) => { await deliverWebhook(job.data.webhookUrl, job.data.payload, job.data.secret); }, { connection, concurrency: 5 });
    taskWorker.on("failed", (job, err) => console.error(`[worker] ${QUEUE_NAMES.automationTasks} job ${job?.id} failed:`, err));
    webhookWorker.on("failed", (job, err) => console.error(`[worker] webhook job ${job?.id} failed:`, err.message));
    schedulerTimer = startScheduler();
    console.log(`[worker ${WORKER_ID}] listening on ${QUEUE_NAMES.automationTasks} (target=render, concurrency=${CONCURRENCY})`);
  }

  const shutdown = async () => {
    console.log("[worker] shutting down...");
    if (schedulerTimer) clearInterval(schedulerTimer);
    if (localPollTimer) clearInterval(localPollTimer);
    await Promise.allSettled([taskWorker?.close(), webhookWorker?.close()].filter(Boolean) as Promise<unknown>[]);
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
main().catch((err) => { console.error("[worker] fatal startup error:", err); process.exit(1); });
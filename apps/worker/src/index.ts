import "dotenv/config";
import { Worker } from "bullmq";
import { connectToDatabase } from "@bos/database";
import { getRedisConnection, type AutomationTaskJobData, type WebhookJobData } from "@bos/queue";
import { QUEUE_NAMES } from "@bos/shared";
import { processTaskJob } from "./processor";
import { deliverWebhook } from "./webhookDelivery";
import { startHealthServer } from "./health";
import { startScheduler } from "./scheduler";

const WORKER_TARGET = (process.env.WORKER_TARGET || "render").toLowerCase() === "local" ? "local" : "render";
const WORKER_ID = process.env.WORKER_ID || `${WORKER_TARGET}-worker-${process.pid}`;
const CONCURRENCY = Number(process.env.BROWSER_MAX_CONCURRENCY ?? (WORKER_TARGET === "local" ? 1 : 3));
const TASK_QUEUE = WORKER_TARGET === "local" ? QUEUE_NAMES.automationTasksLocal : QUEUE_NAMES.automationTasks;

async function main() {
  await connectToDatabase();
  console.log(`[worker ${WORKER_ID}] connected to MongoDB`);
  const connection = getRedisConnection();
  const taskWorker = new Worker<AutomationTaskJobData>(TASK_QUEUE, async (job) => { await processTaskJob(job.data.taskId); }, { connection, concurrency: CONCURRENCY });
  const webhookWorker = new Worker<WebhookJobData>(QUEUE_NAMES.webhooks, async (job) => { await deliverWebhook(job.data.webhookUrl, job.data.payload, job.data.secret); }, { connection, concurrency: WORKER_TARGET === "render" ? 5 : 1 });
  taskWorker.on("failed", (job, err) => console.error(`[worker] ${TASK_QUEUE} job ${job?.id} failed:`, err));
  webhookWorker.on("failed", (job, err) => console.error(`[worker] webhook job ${job?.id} failed:`, err.message));
  const httpServer = startHealthServer(Number(process.env.PORT ?? process.env.WORKER_PORT ?? 4000), WORKER_ID);
  const schedulerTimer = WORKER_TARGET === "render" ? startScheduler() : undefined;
  const shutdown = async () => { console.log("[worker] shutting down..."); if (schedulerTimer) clearInterval(schedulerTimer); await Promise.allSettled([taskWorker.close(), webhookWorker.close()]); httpServer.close(); process.exit(0); };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  console.log(`[worker ${WORKER_ID}] listening on ${TASK_QUEUE} (target=${WORKER_TARGET}, concurrency=${CONCURRENCY})`);
}
main().catch((err) => { console.error("[worker] fatal startup error:", err); process.exit(1); });

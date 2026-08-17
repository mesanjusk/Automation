import "dotenv/config";
import { Worker } from "bullmq";
import { connectToDatabase } from "@bos/database";
import { getRedisConnection, type AutomationTaskJobData, type WebhookJobData } from "@bos/queue";
import { QUEUE_NAMES } from "@bos/shared";
import { processTaskJob } from "./processor";
import { deliverWebhook } from "./webhookDelivery";
import { startHealthServer } from "./health";
import { startScheduler } from "./scheduler";

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const CONCURRENCY = Number(process.env.BROWSER_MAX_CONCURRENCY ?? 3);

async function main() {
  await connectToDatabase();
  console.log(`[worker ${WORKER_ID}] connected to MongoDB`);

  const connection = getRedisConnection();

  const taskWorker = new Worker<AutomationTaskJobData>(
    QUEUE_NAMES.automationTasks,
    async (job) => {
      await processTaskJob(job.data.taskId);
    },
    { connection, concurrency: CONCURRENCY }
  );

  const webhookWorker = new Worker<WebhookJobData>(
    QUEUE_NAMES.webhooks,
    async (job) => {
      await deliverWebhook(job.data.webhookUrl, job.data.payload, job.data.secret);
    },
    { connection, concurrency: 5 }
  );

  taskWorker.on("failed", (job, err) => {
    console.error(`[worker] automation-tasks job ${job?.id} failed:`, err);
  });
  webhookWorker.on("failed", (job, err) => {
    console.error(`[worker] webhook job ${job?.id} failed (will retry):`, err.message);
  });

  const httpServer = startHealthServer(Number(process.env.WORKER_PORT ?? 4000), WORKER_ID);
  const schedulerTimer = startScheduler();

  const shutdown = async () => {
    console.log("[worker] shutting down...");
    clearInterval(schedulerTimer);
    await Promise.allSettled([taskWorker.close(), webhookWorker.close()]);
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log(`[worker ${WORKER_ID}] listening for jobs (concurrency=${CONCURRENCY})`);
}

main().catch((err) => {
  console.error("[worker] fatal startup error:", err);
  process.exit(1);
});

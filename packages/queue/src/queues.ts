import { Queue, QueueEvents } from "bullmq";
import { QUEUE_NAMES } from "@bos/shared";
import { getRedisConnection } from "./connection";

export interface AutomationTaskJobData { taskId: string; }
export interface BrowserSessionJobData { browserProfileId: string; action: "warm" | "close"; }
export interface ScreenshotJobData { taskId: string; stepId: string; fileBuffer: string; mimeType: string; }
export interface WebhookJobData { webhookUrl: string; secret?: string; payload: Record<string, unknown>; }
export interface CleanupJobData { olderThanDays: number; }
export type ExecutionTarget = "render" | "local";

const queueCache = new Map<string, Queue>();
function getQueue<T>(name: string): Queue<T> {
  let queue = queueCache.get(name) as Queue<T> | undefined;
  if (!queue) { queue = new Queue<T>(name, { connection: getRedisConnection() }); queueCache.set(name, queue as Queue); }
  return queue;
}
export const automationTaskQueue = (target: ExecutionTarget = "render") => getQueue<AutomationTaskJobData>(target === "local" ? QUEUE_NAMES.automationTasksLocal : QUEUE_NAMES.automationTasks);
export const browserSessionQueue = () => getQueue<BrowserSessionJobData>(QUEUE_NAMES.browserSessions);
export const screenshotQueue = () => getQueue<ScreenshotJobData>(QUEUE_NAMES.screenshots);
export const webhookQueue = () => getQueue<WebhookJobData>(QUEUE_NAMES.webhooks);
export const cleanupQueue = () => getQueue<CleanupJobData>(QUEUE_NAMES.cleanup);

export async function enqueueAutomationTask(taskId: string, opts?: { priority?: number; delay?: number; target?: ExecutionTarget }): Promise<void> {
  await automationTaskQueue(opts?.target ?? "render").add("run-task", { taskId }, {
    priority: opts?.priority, delay: opts?.delay, attempts: 1,
    removeOnComplete: { age: 86_400 * 7 }, removeOnFail: { age: 86_400 * 30 },
  });
}
export async function enqueueWebhook(data: WebhookJobData): Promise<void> {
  await webhookQueue().add("deliver", data, { attempts: 5, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: { age: 86_400 * 3 }, removeOnFail: { age: 86_400 * 14 } });
}
export function getQueueEvents(name: string): QueueEvents { return new QueueEvents(name, { connection: getRedisConnection() }); }

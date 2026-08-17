import "server-only";
import { dbConnect } from "./db";
import { Task, BrowserProfile, HumanIntervention } from "@bos/database";

export async function getDashboardStats() {
  await dbConnect();

  const [running, queued, completed, failed, waitingForHuman, activeSessions, pendingApprovals, recentTasks] = await Promise.all([
    Task.countDocuments({ status: "RUNNING" }),
    Task.countDocuments({ status: "QUEUED" }),
    Task.countDocuments({ status: "COMPLETED" }),
    Task.countDocuments({ status: "FAILED" }),
    Task.countDocuments({ status: "WAITING_FOR_HUMAN" }),
    BrowserProfile.countDocuments({ status: "in_use" }),
    HumanIntervention.countDocuments({ status: "pending" }),
    Task.find().sort({ createdAt: -1 }).limit(10).populate("automationId", "name").lean(),
  ]);

  const finished = await Task.find({ status: { $in: ["COMPLETED", "FAILED"] }, duration: { $exists: true } })
    .select("status duration")
    .limit(200)
    .lean();
  const totalFinished = finished.length;
  const successCount = finished.filter((t) => t.status === "COMPLETED").length;
  const avgDuration = totalFinished ? finished.reduce((sum, t) => sum + (t.duration ?? 0), 0) / totalFinished : 0;
  const successRate = totalFinished ? (successCount / totalFinished) * 100 : 0;

  return {
    running,
    queued,
    completed,
    failed,
    waitingForHuman,
    activeSessions,
    pendingApprovals,
    recentTasks: JSON.parse(JSON.stringify(recentTasks)) as Array<Record<string, unknown>>,
    avgDuration,
    successRate,
    worker: await getWorkerHealth(),
  };
}

export interface WorkerHealth {
  state: "healthy" | "degraded" | "unreachable" | "unconfigured";
  workerId?: string;
  redis?: string;
  mongodb?: string;
}

/**
 * Polls the worker's GET /health endpoint (observability requirement: the
 * dashboard shows worker health). Configure WORKER_HEALTH_URL (e.g.
 * https://browser-automation-worker.onrender.com/health). Unset means the
 * card shows "not configured" instead of failing the page.
 */
async function getWorkerHealth(): Promise<WorkerHealth> {
  const url = process.env.WORKER_HEALTH_URL;
  if (!url) return { state: "unconfigured" };
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    const body = (await res.json()) as { status?: string; workerId?: string; redis?: string; mongodb?: string };
    return {
      state: res.ok && body.status === "healthy" ? "healthy" : "degraded",
      workerId: body.workerId,
      redis: body.redis,
      mongodb: body.mongodb,
    };
  } catch {
    return { state: "unreachable" };
  }
}

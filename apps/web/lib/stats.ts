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
  };
}

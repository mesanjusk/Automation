import Link from "next/link";
import { getDashboardStats } from "@/lib/stats";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui/primitives";
import { formatDuration, formatRelativeTime } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  const cards = [
    { label: "Running automations", value: stats.running },
    { label: "Queued tasks", value: stats.queued },
    { label: "Successful tasks", value: stats.completed },
    { label: "Failed tasks", value: stats.failed },
    { label: "Needs human intervention", value: stats.waitingForHuman, highlight: stats.waitingForHuman > 0 },
    { label: "Active browser sessions", value: stats.activeSessions },
    { label: "Pending approvals", value: stats.pendingApprovals, highlight: stats.pendingApprovals > 0 },
    { label: "Success rate", value: `${stats.successRate.toFixed(0)}%` },
    { label: "Avg. execution time", value: formatDuration(stats.avgDuration) },
    {
      label: "Worker status",
      value:
        stats.worker.state === "unconfigured"
          ? "not configured"
          : `${stats.worker.state}${stats.worker.workerId ? ` (${stats.worker.workerId})` : ""}`,
      highlight: stats.worker.state === "degraded" || stats.worker.state === "unreachable",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">An overview of every automation running on this platform.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader>
              <CardTitle>{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={"text-2xl font-semibold " + (c.highlight ? "text-warning" : "")}>{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent executions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Automation</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentTasks.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No tasks yet. Run an automation to see it here.
                  </td>
                </tr>
              )}
              {stats.recentTasks.map((t) => (
                <tr key={t._id as string} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/tasks/${t._id}`} className="hover:underline">
                      {(t.automationId as { name?: string } | undefined)?.name ?? "Unknown automation"}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={t.status as string} />
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{formatRelativeTime(t.startedAt as string)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDuration(t.duration as number | undefined)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

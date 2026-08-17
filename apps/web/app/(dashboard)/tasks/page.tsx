import Link from "next/link";
import { dbConnect } from "@/lib/db";
import { Task } from "@bos/database";
import { Card, CardContent, EmptyState } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/status-badge";
import { formatDuration, formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: { status?: string } }) {
  await dbConnect();
  const filter = searchParams.status ? { status: searchParams.status } : {};
  const tasks = await Task.find(filter).sort({ createdAt: -1 }).limit(100).populate("automationId", "name").lean();

  const statuses = ["QUEUED", "RUNNING", "WAITING_FOR_HUMAN", "COMPLETED", "FAILED", "CANCELLED"];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <p className="text-sm text-muted-foreground">Every automation run, across every automation.</p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Link href="/tasks" className={"rounded-full border border-border px-3 py-1 " + (!searchParams.status ? "bg-primary/10 text-primary" : "")}>
          All
        </Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/tasks?status=${s}`}
            className={"rounded-full border border-border px-3 py-1 " + (searchParams.status === s ? "bg-primary/10 text-primary" : "")}
          >
            {s.replaceAll("_", " ")}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <EmptyState title="No tasks found" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Automation</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Started</th>
                  <th className="px-4 py-2 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={String(t._id)} className="border-b border-border last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-2">
                      <Link href={`/tasks/${t._id}`} className="hover:underline">
                        {(t.automationId as { name?: string } | undefined)?.name ?? "Unknown"}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{t.source}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatRelativeTime(t.startedAt)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatDuration(t.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

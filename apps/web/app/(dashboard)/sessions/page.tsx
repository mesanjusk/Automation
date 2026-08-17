import Link from "next/link";
import { dbConnect } from "@/lib/db";
import { Task, BrowserProfile } from "@bos/database";
import { Card, CardContent, EmptyState } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/status-badge";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  await dbConnect();
  const liveTasks = await Task.find({ status: { $in: ["RUNNING", "STARTING", "WAITING_FOR_HUMAN"] } })
    .sort({ startedAt: -1 })
    .populate("automationId", "name")
    .populate("browserProfileId", "name")
    .lean();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Live Sessions</h1>
        <p className="text-sm text-muted-foreground">Browser sessions currently open on a worker, one per in-flight task.</p>
      </div>

      {liveTasks.length === 0 ? (
        <EmptyState title="No live sessions" description="Run an automation to see its browser session here in real time." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {liveTasks.map((t) => (
            <Link key={String(t._id)} href={`/tasks/${t._id}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="flex flex-col gap-2 pt-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{(t.automationId as { name?: string } | undefined)?.name ?? "Automation"}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">Profile: {(t.browserProfileId as { name?: string } | undefined)?.name ?? "Fresh session"}</p>
                  <p className="text-xs text-muted-foreground">Worker: {t.workerId ?? "assigning..."}</p>
                  <p className="text-xs text-muted-foreground">Started {formatRelativeTime(t.startedAt)}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

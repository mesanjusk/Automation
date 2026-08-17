import { dbConnect } from "@/lib/db";
import { ExecutionStep } from "@bos/database";
import { Card, CardContent, Badge, EmptyState } from "@/components/ui/primitives";
import { formatDuration, formatRelativeTime } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function LogsPage({ searchParams }: { searchParams: { taskId?: string } }) {
  await dbConnect();
  const filter = searchParams.taskId ? { taskId: searchParams.taskId } : {};
  const steps = await ExecutionStep.find(filter).sort({ timestamp: -1 }).limit(200).lean();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Execution Logs</h1>
        <p className="text-sm text-muted-foreground">Every action any worker has taken, across every task.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {steps.length === 0 ? (
            <EmptyState title="No execution steps logged yet" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Task</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Selector</th>
                  <th className="px-4 py-2 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={String(s._id)} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-xs text-muted-foreground">{formatRelativeTime(s.timestamp)}</td>
                    <td className="px-4 py-2">
                      <Link href={`/tasks/${s.taskId}`} className="font-mono text-xs hover:underline">{String(s.taskId).slice(-8)}</Link>
                    </td>
                    <td className="px-4 py-2">{s.name ?? s.action}</td>
                    <td className="px-4 py-2">
                      <Badge variant={s.status === "SUCCESS" ? "success" : s.status === "FAILED" ? "destructive" : "outline"}>{s.status}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{s.selectorStrategyUsed ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatDuration(s.duration)}</td>
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

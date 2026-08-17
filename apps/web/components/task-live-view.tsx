"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/status-badge";
import { formatDuration, formatRelativeTime } from "@/lib/utils";
import { cancelTask, resumeTask, retryTask, resolveHumanIntervention } from "@/lib/actions/tasks";
import { Pause, Play, XCircle, RotateCcw, CheckCircle2, XOctagon } from "lucide-react";

const LIVE_STATUSES = new Set(["QUEUED", "STARTING", "RUNNING", "RETRYING"]);

interface TaskData {
  _id: string;
  status: string;
  automationId?: { name?: string };
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  workerId?: string;
  browserProfileId?: string;
  variables?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: { message?: string; category?: string };
  currentStepId?: string;
}

interface StepData {
  _id: string;
  stepId: string;
  action: string;
  name?: string;
  status: string;
  duration?: number;
  timestamp: string;
  selectorStrategyUsed?: string;
  error?: { message?: string };
  screenshotId?: { url?: string };
}

export function TaskLiveView({ taskId, initialTask, initialSteps, initialIntervention }: {
  taskId: string;
  initialTask: TaskData;
  initialSteps: StepData[];
  initialIntervention: { _id: string; message: string } | null;
}) {
  const [task, setTask] = useState(initialTask);
  const [steps, setSteps] = useState(initialSteps);
  const [intervention, setIntervention] = useState(initialIntervention);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!LIVE_STATUSES.has(task.status)) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/tasks/${taskId}/status`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setTask(data.task);
      setSteps(data.steps);
      setIntervention(data.pendingIntervention);
    }, 2500);
    return () => clearInterval(interval);
  }, [task.status, taskId]);

  const lastScreenshot = [...steps].reverse().find((s) => s.screenshotId?.url)?.screenshotId?.url;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{task.automationId?.name ?? "Task"}</h1>
          <p className="font-mono text-xs text-muted-foreground">{taskId}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={task.status} />
          {LIVE_STATUSES.has(task.status) && (
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => startTransition(async () => { await cancelTask(taskId); router.refresh(); })}
            >
              <XCircle className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
          {task.status === "WAITING_FOR_HUMAN" && !intervention && (
            <Button size="sm" disabled={pending} onClick={() => startTransition(async () => { await resumeTask(taskId); router.refresh(); })}>
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          )}
          {task.status === "FAILED" && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => startTransition(async () => { const id = await retryTask(taskId); router.push(`/tasks/${id}`); })}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </Button>
          )}
        </div>
      </div>

      {intervention && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="flex items-center justify-between pt-4">
            <div>
              <p className="text-sm font-medium">Human approval required</p>
              <p className="text-sm text-muted-foreground">{intervention.message}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="success"
                size="sm"
                disabled={pending}
                onClick={() => startTransition(async () => { await resolveHumanIntervention(intervention._id, "approved"); router.refresh(); })}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={() => startTransition(async () => { await resolveHumanIntervention(intervention._id, "rejected"); router.refresh(); })}
              >
                <XOctagon className="h-3.5 w-3.5" /> Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <InfoCard label="Started" value={formatRelativeTime(task.startedAt)} />
        <InfoCard label="Duration" value={formatDuration(task.duration)} />
        <InfoCard label="Worker" value={task.workerId ?? "—"} />
        <InfoCard label="Current step" value={task.currentStepId ?? steps.at(-1)?.stepId ?? "—"} />
      </div>

      {task.error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-4 text-sm">
            <p className="font-medium text-destructive">{task.error.category}</p>
            <p className="text-muted-foreground">{task.error.message}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Latest screenshot</CardTitle>
          </CardHeader>
          <CardContent>
            {lastScreenshot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lastScreenshot} alt="Latest screenshot" className="w-full rounded-md border border-border" />
            ) : (
              <p className="text-sm text-muted-foreground">No screenshots captured yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Execution log</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[480px] overflow-y-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Step</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Selector</th>
                  <th className="px-4 py-2 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {steps.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      Waiting for the worker to pick up this task...
                    </td>
                  </tr>
                )}
                {steps.map((s) => (
                  <tr key={s._id} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-2">
                      <p className="font-medium">{s.name ?? s.action}</p>
                      <p className="text-xs text-muted-foreground">{s.action}</p>
                      {s.error?.message && <p className="text-xs text-destructive">{s.error.message}</p>}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={s.status === "SUCCESS" ? "success" : s.status === "FAILED" ? "destructive" : "outline"}>{s.status}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{s.selectorStrategyUsed ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatDuration(s.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Variables</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(task.variables ?? {}, null, 2)}</pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Output</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(task.output ?? {}, null, 2)}</pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}

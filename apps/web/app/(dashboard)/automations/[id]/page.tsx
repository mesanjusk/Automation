import Link from "next/link";
import { notFound } from "next/navigation";
import { dbConnect } from "@/lib/db";
import { Automation, Task, Workflow, BrowserProfile } from "@bos/database";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/status-badge";
import { RunAutomationButton } from "@/components/run-automation-button";
import { EnabledToggle, DuplicateButton } from "@/components/automation-controls";
import { updateAutomation } from "@/lib/actions/automations";
import { formatDuration, formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AutomationDetailPage({ params }: { params: { id: string } }) {
  await dbConnect();
  const automation = await Automation.findById(params.id).populate("workflowId", "name status").lean();
  if (!automation) notFound();

  const [profiles, tasks] = await Promise.all([
    BrowserProfile.find().lean(),
    Task.find({ automationId: params.id }).sort({ createdAt: -1 }).limit(25).lean(),
  ]);

  const finished = tasks.filter((t) => t.status === "COMPLETED" || t.status === "FAILED");
  const successRate = finished.length ? (finished.filter((t) => t.status === "COMPLETED").length / finished.length) * 100 : 0;
  const avgDuration = finished.length ? finished.reduce((s, t) => s + (t.duration ?? 0), 0) / finished.length : 0;
  const updateWithId = updateAutomation.bind(null, params.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{automation.name}</h1>
          <p className="text-sm text-muted-foreground">{automation.description || "No description"}</p>
        </div>
        <div className="flex items-center gap-2">
          <EnabledToggle automationId={params.id} enabled={automation.enabled} />
          <DuplicateButton automationId={params.id} />
          <RunAutomationButton automationId={params.id} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Success rate</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{successRate.toFixed(0)}%</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Avg. duration</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{formatDuration(avgDuration)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Total runs</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{tasks.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workflow</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href={`/workflows/${(automation.workflowId as { _id?: string })?._id}`} className="text-sm font-medium hover:underline">
              {(automation.workflowId as { name?: string } | undefined)?.name ?? "—"}
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateWithId} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" defaultValue={automation.name} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" rows={3} defaultValue={automation.description} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="browserProfileId">Browser profile</Label>
                <Select id="browserProfileId" name="browserProfileId" defaultValue={String(automation.browserProfileId ?? "")}>
                  <option value="">None</option>
                  {profiles.map((p) => (
                    <option key={String(p._id)} value={String(p._id)}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="callbackUrl">Callback URL</Label>
                <Input id="callbackUrl" name="callbackUrl" defaultValue={automation.callbackUrl} placeholder="https://your-crm.com/..." />
              </div>
              <Button type="submit" size="sm">
                Save changes
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Execution history</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Started</th>
                  <th className="px-4 py-2 font-medium">Duration</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      No runs yet.
                    </td>
                  </tr>
                )}
                {tasks.map((t) => (
                  <tr key={String(t._id)} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/tasks/${t._id}`} className="hover:underline">
                        <StatusBadge status={t.status} />
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{formatRelativeTime(t.startedAt)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatDuration(t.duration)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{t.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

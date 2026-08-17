import { dbConnect } from "@/lib/db";
import { Schedule, Automation } from "@bos/database";
import { Card, CardContent, Button, Select, Input, Label, EmptyState } from "@/components/ui/primitives";
import { createSchedule } from "@/lib/actions/schedules";
import { ScheduleRowControls } from "@/components/schedule-row-controls";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  await dbConnect();
  const [schedules, automations] = await Promise.all([
    Schedule.find().sort({ createdAt: -1 }).populate("automationId", "name").lean(),
    Automation.find().lean(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Schedules</h1>
        <p className="text-sm text-muted-foreground">Run automations automatically — once, hourly, daily, weekly, or on a custom cron.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form action={createSchedule} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="automationId">Automation</Label>
              <Select id="automationId" name="automationId" required className="w-64" defaultValue="">
                <option value="" disabled>Select automation</option>
                {automations.map((a) => (
                  <option key={String(a._id)} value={String(a._id)}>{a.name}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="frequency">Frequency</Label>
              <Select id="frequency" name="frequency" defaultValue="DAILY" className="w-40">
                <option value="ONCE">Once</option>
                <option value="HOURLY">Hourly</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="CRON">Custom cron</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cronExpression">Cron expression (if custom)</Label>
              <Input id="cronExpression" name="cronExpression" placeholder="0 9 * * *" className="w-40" />
            </div>
            <Button type="submit">Add schedule</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {schedules.length === 0 ? (
            <EmptyState title="No schedules yet" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Automation</th>
                  <th className="px-4 py-2 font-medium">Frequency</th>
                  <th className="px-4 py-2 font-medium">Next run</th>
                  <th className="px-4 py-2 font-medium">Last run</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={String(s._id)} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">{(s.automationId as { name?: string } | undefined)?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{s.frequency}{s.cronExpression ? ` (${s.cronExpression})` : ""}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatRelativeTime(s.nextRunAt)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatRelativeTime(s.lastRunAt)}</td>
                    <td className="px-4 py-2">
                      <ScheduleRowControls scheduleId={String(s._id)} enabled={s.enabled} />
                    </td>
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

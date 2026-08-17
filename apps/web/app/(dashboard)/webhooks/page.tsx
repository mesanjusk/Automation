import { dbConnect } from "@/lib/db";
import { Webhook } from "@bos/database";
import { Card, CardContent, Button, Input, Label, EmptyState, Badge } from "@/components/ui/primitives";
import { createWebhook } from "@/lib/actions/webhooks";
import { WebhookRowControls } from "@/components/webhook-row-controls";

export const dynamic = "force-dynamic";

const EVENT_OPTIONS = [
  "automation.started",
  "automation.completed",
  "automation.failed",
  "automation.human_intervention_required",
  "automation.cancelled",
];

export default async function WebhooksPage() {
  await dbConnect();
  const webhooks = await Webhook.find().sort({ createdAt: -1 }).lean();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Webhooks</h1>
        <p className="text-sm text-muted-foreground">
          Outgoing notifications for anything outside a per-task callback URL — e.g. a CRM that wants to hear about every automation event.
          Payloads are HMAC-SHA256 signed with a per-webhook secret (X-BOS-Signature header).
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form action={createWebhook} className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required className="w-56" />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="url">URL</Label>
                <Input id="url" name="url" type="url" required placeholder="https://your-crm.com/webhooks/automation" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Events</Label>
              <div className="flex flex-wrap gap-3 text-sm">
                {EVENT_OPTIONS.map((ev) => (
                  <label key={ev} className="flex items-center gap-1.5">
                    <input type="checkbox" name="events" value={ev} defaultChecked={ev === "automation.completed" || ev === "automation.failed"} />
                    {ev}
                  </label>
                ))}
              </div>
            </div>
            <Button type="submit" className="w-fit">Add webhook</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {webhooks.length === 0 ? (
            <EmptyState title="No webhooks configured" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">URL</th>
                  <th className="px-4 py-2 font-medium">Events</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((w) => (
                  <tr key={String(w._id)} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">{w.name}</td>
                    <td className="px-4 py-2 truncate max-w-[260px] font-mono text-xs text-muted-foreground">{w.url}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{w.events.join(", ")}</td>
                    <td className="px-4 py-2">
                      <Badge variant={w.enabled ? "success" : "outline"}>{w.enabled ? "Enabled" : "Disabled"}</Badge>
                    </td>
                    <td className="px-4 py-2">
                      <WebhookRowControls webhookId={String(w._id)} enabled={w.enabled} />
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

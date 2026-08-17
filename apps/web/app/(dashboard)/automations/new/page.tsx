import { dbConnect } from "@/lib/db";
import { Workflow, BrowserProfile } from "@bos/database";
import { createAutomation } from "@/lib/actions/automations";
import { Card, CardContent, Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function NewAutomationPage() {
  await dbConnect();
  const [workflows, profiles] = await Promise.all([
    Workflow.find().sort({ createdAt: -1 }).lean(),
    BrowserProfile.find().sort({ createdAt: -1 }).lean(),
  ]);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">New automation</h1>
        <p className="text-sm text-muted-foreground">Wrap a workflow into a reusable, API-triggerable automation.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form action={createAutomation} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required placeholder="e.g. Supplier Stock Checker" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={3} placeholder="What does this automation do?" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflowId">Workflow</Label>
              <Select id="workflowId" name="workflowId" required defaultValue="">
                <option value="" disabled>
                  Select a workflow
                </option>
                {workflows.map((w) => (
                  <option key={String(w._id)} value={String(w._id)}>
                    {w.name} ({w.status})
                  </option>
                ))}
              </Select>
              {workflows.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No workflows yet — <a href="/workflows/new" className="underline">create one first</a>.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="browserProfileId">Browser profile (optional)</Label>
              <Select id="browserProfileId" name="browserProfileId" defaultValue="">
                <option value="">None — fresh browser each run</option>
                {profiles.map((p) => (
                  <option key={String(p._id)} value={String(p._id)}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="callbackUrl">Default callback URL (optional)</Label>
              <Input id="callbackUrl" name="callbackUrl" placeholder="https://your-crm.com/api/automation/callback" />
            </div>
            <Button type="submit">Create automation</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

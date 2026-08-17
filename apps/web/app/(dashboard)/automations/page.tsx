import Link from "next/link";
import { dbConnect } from "@/lib/db";
import { Automation } from "@bos/database";
import { Card, CardContent, Button, Badge, EmptyState } from "@/components/ui/primitives";
import { RunAutomationButton } from "@/components/run-automation-button";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  await dbConnect();
  const automations = await Automation.find().sort({ createdAt: -1 }).populate("workflowId", "name status").lean();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Automations</h1>
          <p className="text-sm text-muted-foreground">Generic, reusable automations built on top of your workflows.</p>
        </div>
        <Link href="/automations/new">
          <Button>
            <Plus className="h-4 w-4" /> New automation
          </Button>
        </Link>
      </div>

      {automations.length === 0 ? (
        <EmptyState title="No automations yet" description="Create your first automation from a workflow." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {automations.map((a) => (
            <Card key={String(a._id)}>
              <CardContent className="flex flex-col gap-3 pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <Link href={`/automations/${a._id}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{(a.workflowId as { name?: string } | undefined)?.name ?? "No workflow"}</p>
                  </div>
                  <Badge variant={a.enabled ? "success" : "outline"}>{a.enabled ? "Enabled" : "Disabled"}</Badge>
                </div>
                {a.description && <p className="line-clamp-2 text-sm text-muted-foreground">{a.description}</p>}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">/{a.slug}</span>
                  <RunAutomationButton automationId={String(a._id)} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

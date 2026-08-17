import Link from "next/link";
import { dbConnect } from "@/lib/db";
import { Workflow } from "@bos/database";
import { Card, CardContent, Button, Badge, EmptyState } from "@/components/ui/primitives";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  await dbConnect();
  const workflows = await Workflow.find().sort({ updatedAt: -1 }).lean();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Workflows</h1>
          <p className="text-sm text-muted-foreground">Reusable node graphs that power your automations.</p>
        </div>
        <Link href="/workflows/new">
          <Button>
            <Plus className="h-4 w-4" /> New workflow
          </Button>
        </Link>
      </div>

      {workflows.length === 0 ? (
        <EmptyState title="No workflows yet" description="Build your first workflow visually or generate one from a description." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workflows.map((w) => (
            <Link key={String(w._id)} href={`/workflows/${w._id}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="flex flex-col gap-2 pt-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{w.name}</span>
                    <Badge variant={w.status === "published" ? "success" : "outline"}>{w.status}</Badge>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{w.description || "No description"}</p>
                  <span className="text-xs text-muted-foreground">v{w.currentVersion}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

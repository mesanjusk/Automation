import { createWorkflow } from "@/lib/actions/workflows";
import { Card, CardContent, Button, Input, Label, Textarea } from "@/components/ui/primitives";

export default function NewWorkflowPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">New workflow</h1>
        <p className="text-sm text-muted-foreground">Start blank, then build visually or describe it in plain English on the next screen.</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <form action={createWorkflow} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required placeholder="e.g. Login + Search + Download" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={3} />
            </div>
            <Button type="submit">Create workflow</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

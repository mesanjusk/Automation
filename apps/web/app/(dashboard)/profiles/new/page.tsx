import { createProfile } from "@/lib/actions/profiles";
import { Card, CardContent, Button, Input, Label, Textarea } from "@/components/ui/primitives";

export default function NewProfilePage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">New browser profile</h1>
        <p className="text-sm text-muted-foreground">Create the identity first, then log in manually via the CLI helper to save its session.</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <form action={createProfile} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required placeholder="e.g. Supplier Portal Login" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={2} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="userAgent">User agent (optional)</Label>
              <Input id="userAgent" name="userAgent" placeholder="Leave blank to use Chromium's default" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="locale">Locale</Label>
                <Input id="locale" name="locale" defaultValue="en-US" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="timezone">Timezone</Label>
                <Input id="timezone" name="timezone" defaultValue="UTC" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="width">Viewport width</Label>
                <Input id="width" name="width" type="number" defaultValue={1440} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="height">Viewport height</Label>
                <Input id="height" name="height" type="number" defaultValue={900} />
              </div>
            </div>
            <Button type="submit">Create profile</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

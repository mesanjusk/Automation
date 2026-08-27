import Link from "next/link";
import { dbConnect } from "@/lib/db";
import { BrowserProfile } from "@bos/database";
import { runIdeaToFlowVideo } from "@/lib/actions/videoStudio";
import { Button, Card, CardContent, Label, Select, Textarea, Badge } from "@/components/ui/primitives";
import { Video, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function VideoStudioPage() {
  await dbConnect();
  const profiles = await BrowserProfile.find().sort({ updatedAt: -1 }).select("name status encryptedStorageState").lean();
  const ready = profiles.filter((p) => !!p.encryptedStorageState);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Video className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Video Studio</h1>
            <Badge variant="success">No AI API required</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Tell us only the idea. Automation uses your logged-in ChatGPT browser session to build the full production brief, then sends it to Google Flow Agent to start video generation.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <form action={runIdeaToFlowVideo} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="idea">Your idea</Label>
              <Textarea
                id="idea"
                name="idea"
                required
                minLength={5}
                rows={5}
                placeholder="Example: Raksha Bandhan ad for Ved Mala gift hamper. Brother should gift it to sister. Emotional + premium, Hindi voiceover, strong hook and final DM CTA."
                className="text-base"
              />
              <p className="text-xs text-muted-foreground">No need to specify scenes, camera, clip length, continuity, captions, character consistency or Flow prompts. Those rules are built in.</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="browserProfileId">Browser profile</Label>
              {ready.length ? (
                <Select id="browserProfileId" name="browserProfileId" required defaultValue={String(ready[0]?._id ?? "")}>
                  {ready.map((p) => (
                    <option key={String(p._id)} value={String(p._id)}>{p.name} · {p.status}</option>
                  ))}
                </Select>
              ) : (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                  No saved browser session is available. Create one profile and log in to both ChatGPT and Google Flow in that same profile first. <Link href="/profiles" className="font-medium underline">Open Browser Profiles</Link>.
                </div>
              )}
            </div>

            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <p className="font-medium">Built-in production defaults</p>
              <p className="mt-1 text-muted-foreground">9:16 social format · strong opening hook · 6–8 second shots · same character/product across clips · voiceover + timed on-screen text when useful · continuity from previous ending · final CTA when the concept needs one.</p>
            </div>

            <Button type="submit" size="lg" disabled={!ready.length} className="w-full">
              <Sparkles className="h-4 w-4" /> Create video from idea
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        This path does not call Gemini, OpenAI or Claude APIs. ChatGPT and Flow still need to be available in the selected logged-in browser account, and Flow generation remains subject to your Google account's available features/credits.
      </p>
    </div>
  );
}

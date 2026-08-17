import Link from "next/link";
import { dbConnect } from "@/lib/db";
import { BrowserProfile } from "@bos/database";
import { Card, CardContent, Button, Badge, EmptyState } from "@/components/ui/primitives";
import { ProfileSessionControls } from "@/components/profile-session-controls";
import { formatRelativeTime } from "@/lib/utils";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ProfilesPage() {
  await dbConnect();
  const profiles = await BrowserProfile.find().sort({ createdAt: -1 }).select("+encryptedStorageState").lean();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Browser Profiles</h1>
          <p className="text-sm text-muted-foreground">
            Persistent identities (cookies, locale, viewport) automations reuse across runs. To log in manually, use the{" "}
            <code className="rounded bg-muted px-1 py-0.5">npm run login-helper -- --profile=&lt;id&gt;</code> CLI (see README) — it opens a real
            headed browser on your machine and saves the session here when you close it.
          </p>
        </div>
        <Link href="/profiles/new">
          <Button>
            <Plus className="h-4 w-4" /> New profile
          </Button>
        </Link>
      </div>

      {profiles.length === 0 ? (
        <EmptyState title="No browser profiles yet" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {profiles.map((p) => (
            <Card key={String(p._id)}>
              <CardContent className="flex flex-col gap-3 pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.locale} · {p.timezone}</p>
                  </div>
                  <Badge variant={p.status === "ready" || p.status === "in_use" ? "success" : "outline"}>{p.status}</Badge>
                </div>
                {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                <p className="text-xs text-muted-foreground">Last used {formatRelativeTime(p.lastUsedAt)}</p>
                <ProfileSessionControls profileId={String(p._id)} hasSession={!!p.encryptedStorageState} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { dbConnect } from "@/lib/db";
import { File as FileModel } from "@bos/database";
import { Card, CardContent, EmptyState } from "@/components/ui/primitives";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ScreenshotsPage() {
  await dbConnect();
  const screenshots = await FileModel.find({ kind: "screenshot" }).sort({ createdAt: -1 }).limit(60).lean();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Screenshots</h1>
        <p className="text-sm text-muted-foreground">Captured automatically during execution (and on demand via the SCREENSHOT node).</p>
      </div>

      {screenshots.length === 0 ? (
        <EmptyState title="No screenshots yet" />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {screenshots.map((s) => (
            <Link key={String(s._id)} href={`/tasks/${s.taskId}`}>
              <Card className="overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.name} className="aspect-video w-full object-cover" />
                <CardContent className="p-2">
                  <p className="truncate text-xs">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{formatRelativeTime(s.createdAt)}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

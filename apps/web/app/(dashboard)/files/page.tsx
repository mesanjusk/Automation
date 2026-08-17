import { dbConnect } from "@/lib/db";
import { File as FileModel } from "@bos/database";
import { Card, CardContent, Badge, EmptyState } from "@/components/ui/primitives";
import { formatRelativeTime } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function FilesPage() {
  await dbConnect();
  const files = await FileModel.find().sort({ createdAt: -1 }).limit(150).lean();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Files</h1>
        <p className="text-sm text-muted-foreground">Downloads, uploads, screenshots and generated files from every task.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {files.length === 0 ? (
            <EmptyState title="No files yet" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Kind</th>
                  <th className="px-4 py-2 font-medium">Size</th>
                  <th className="px-4 py-2 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Task</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={String(f._id)} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <a href={f.url} target="_blank" rel="noreferrer" className="hover:underline">{f.name}</a>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="outline">{f.kind}</Badge>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{formatBytes(f.size)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{f.provider}</td>
                    <td className="px-4 py-2">
                      {f.taskId ? <Link href={`/tasks/${f.taskId}`} className="font-mono text-xs hover:underline">{String(f.taskId).slice(-8)}</Link> : "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{formatRelativeTime(f.createdAt)}</td>
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

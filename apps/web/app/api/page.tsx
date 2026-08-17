import { dbConnect } from "@/lib/db";
import { ApiKey } from "@bos/database";
import { Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui/primitives";
import { CreateApiKeyForm } from "@/components/create-api-key-form";
import { RevokeApiKeyButton } from "@/components/revoke-api-key-button";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ENDPOINTS = [
  { method: "POST", path: "/api/v1/automations/run", desc: "Queue a task for an automation. Body: { automation, input, callbackUrl? }" },
  { method: "GET", path: "/api/v1/automations", desc: "List automations available to run." },
  { method: "GET", path: "/api/v1/workflows", desc: "List workflows and their published versions." },
  { method: "GET", path: "/api/v1/tasks/:id", desc: "Get a task's status, output and error." },
  { method: "POST", path: "/api/v1/tasks/:id/cancel", desc: "Cancel a queued or running task." },
  { method: "POST", path: "/api/v1/tasks/:id/resume", desc: "Resume a task that is WAITING_FOR_HUMAN." },
];

export default async function ApiPage() {
  await dbConnect();
  const keys = await ApiKey.find().sort({ createdAt: -1 }).lean();
  const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">API</h1>
        <p className="text-sm text-muted-foreground">
          This is how your CRM (or anything else) drives automations. Send <code className="rounded bg-muted px-1 py-0.5">X-API-Key</code>{" "}
          on every request.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CreateApiKeyForm />
          {keys.length === 0 ? (
            <EmptyState title="No API keys yet" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Prefix</th>
                  <th className="py-2 font-medium">Created</th>
                  <th className="py-2 font-medium">Last used</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={String(k._id)} className="border-b border-border last:border-0">
                    <td className="py-2">{k.name}</td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">{k.prefix}…</td>
                    <td className="py-2 text-muted-foreground">{formatRelativeTime(k.createdAt)}</td>
                    <td className="py-2 text-muted-foreground">{formatRelativeTime(k.lastUsedAt)}</td>
                    <td className="py-2">
                      <Badge variant={k.revoked ? "destructive" : "success"}>{k.revoked ? "Revoked" : "Active"}</Badge>
                    </td>
                    <td className="py-2 text-right">{!k.revoked && <RevokeApiKeyButton apiKeyId={String(k._id)} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border">
          {ENDPOINTS.map((e) => (
            <div key={e.path} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2 font-mono text-xs">
                <Badge variant="outline">{e.method}</Badge>
                <span>{baseUrl}{e.path}</span>
              </div>
              <p className="text-sm text-muted-foreground">{e.desc}</p>
            </div>
          ))}
          <div className="pt-3">
            <p className="mb-1 text-sm font-medium">Example</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`curl -X POST ${baseUrl}/api/v1/automations/run \\
  -H "X-API-Key: bos_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"automation":"supplier-stock-check","input":{"products":["P001"]},"callbackUrl":"https://your-crm.com/api/automation/callback"}'`}</pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { dbConnect } from "@/lib/db";
import { Credential, BrowserProfile } from "@bos/database";
import { Card, CardContent, Button, Input, Label, Select, EmptyState } from "@/components/ui/primitives";
import { createCredential } from "@/lib/actions/credentials";
import { DeleteCredentialButton } from "@/components/delete-credential-button";
import { formatRelativeTime } from "@/lib/utils";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  await dbConnect();
  const [credentials, profiles] = await Promise.all([
    Credential.find().sort({ createdAt: -1 }).populate("browserProfileId", "name").lean(),
    BrowserProfile.find().lean(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Credentials</h1>
        <p className="text-sm text-muted-foreground">
          Encrypted at rest with AES-256-GCM. Never shown again after creation — reference a credential from a workflow's TYPE node with{" "}
          <code className="rounded bg-muted px-1 py-0.5">{"{{secret:name}}"}</code>; the value is decrypted just-in-time and never logged, screenshotted, or sent to the AI.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form action={createCredential} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name (used as {"{{secret:name}}"})</Label>
              <Input id="name" name="name" required placeholder="supplier_password" className="w-56" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type">Type</Label>
              <Select id="type" name="type" defaultValue="password" className="w-36">
                <option value="password">Password</option>
                <option value="api_key">API key</option>
                <option value="totp_seed">TOTP seed</option>
                <option value="generic">Generic</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Username (optional, not encrypted)</Label>
              <Input id="username" name="username" className="w-48" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="value">Value</Label>
              <Input id="value" name="value" type="password" required className="w-56" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="browserProfileId">Scope to profile (optional)</Label>
              <Select id="browserProfileId" name="browserProfileId" defaultValue="" className="w-48">
                <option value="">Any profile</option>
                {profiles.map((p) => (
                  <option key={String(p._id)} value={String(p._id)}>{p.name}</option>
                ))}
              </Select>
            </div>
            <Button type="submit">Save credential</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {credentials.length === 0 ? (
            <EmptyState title="No credentials stored" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Scope</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((c) => (
                  <tr key={String(c._id)} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">
                      <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-success" />{c.name}</span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.type}</td>
                    <td className="px-4 py-2 text-muted-foreground">{(c.browserProfileId as { name?: string } | undefined)?.name ?? "Any profile"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatRelativeTime(c.createdAt)}</td>
                    <td className="px-4 py-2 text-right">
                      <DeleteCredentialButton credentialId={String(c._id)} />
                    </td>
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

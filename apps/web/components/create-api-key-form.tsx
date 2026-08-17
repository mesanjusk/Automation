"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui/primitives";
import { createApiKey } from "@/lib/actions/apiKeys";
import { Copy } from "lucide-react";

export function CreateApiKeyForm() {
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData();
          formData.set("name", name);
          startTransition(async () => {
            const key = await createApiKey(formData);
            setNewKey(key);
            setName("");
            router.refresh();
          });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="key-name">Key name</Label>
          <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. CRM production" className="w-56" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating..." : "Create API key"}
        </Button>
      </form>
      {newKey && (
        <div className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/5 px-3 py-2 text-sm">
          <code className="flex-1 overflow-x-auto font-mono text-xs">{newKey}</code>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => navigator.clipboard.writeText(newKey)}
            title="Copy"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      )}
      {newKey && <p className="text-xs text-warning">Store this now — it will not be shown again.</p>}
    </div>
  );
}

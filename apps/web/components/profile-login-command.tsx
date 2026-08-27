"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { Copy, Check } from "lucide-react";

export function ProfileLoginCommand({ profileId }: { profileId: string }) {
  const [copied, setCopied] = useState(false);
  const command = `npm run connect-browser -- --profile=${profileId}`;

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Profile ID</p>
        <code className="break-all text-xs text-muted-foreground">{profileId}</code>
      </div>
      <code className="block break-all rounded bg-background px-2 py-2 text-[11px]">{command}</code>
      <Button type="button" size="sm" variant="outline" onClick={copyCommand}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy connect command"}
      </Button>
      <p className="text-[11px] text-muted-foreground">Run this from the Automation project on your computer. Normal installed Chrome opens first. Log into ChatGPT and Google Flow before returning to the terminal and pressing Enter; automation attaches only after login to save the reusable session.</p>
    </div>
  );
}

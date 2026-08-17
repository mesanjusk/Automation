"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { toggleWebhook, deleteWebhook } from "@/lib/actions/webhooks";

export function WebhookRowControls({ webhookId, enabled }: { webhookId: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <div className="flex justify-end gap-1.5">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(async () => { await toggleWebhook(webhookId, !enabled); router.refresh(); })}>
        {enabled ? "Disable" : "Enable"}
      </Button>
      <Button variant="ghost" size="icon" disabled={pending} onClick={() => startTransition(async () => { await deleteWebhook(webhookId); router.refresh(); })}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

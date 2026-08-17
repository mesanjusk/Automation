"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { toggleAutomationEnabled, duplicateAutomation } from "@/lib/actions/automations";

export function EnabledToggle({ automationId, enabled }: { automationId: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={enabled ? "outline" : "success"}
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => toggleAutomationEnabled(automationId, !enabled))}
    >
      {enabled ? "Disable" : "Enable"}
    </Button>
  );
}

export function DuplicateButton({ automationId }: { automationId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await duplicateAutomation(automationId);
          router.refresh();
        })
      }
    >
      <Copy className="h-3.5 w-3.5" /> Duplicate
    </Button>
  );
}

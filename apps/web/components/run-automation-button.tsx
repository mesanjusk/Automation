"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { runAutomationNow } from "@/lib/actions/automations";

export function RunAutomationButton({ automationId }: { automationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              const taskId = await runAutomationNow(automationId, {});
              router.push(`/tasks/${taskId}`);
            } catch (err) {
              setError((err as Error).message);
            }
          })
        }
      >
        <Play className="h-3.5 w-3.5" />
        {pending ? "Starting..." : "Run"}
      </Button>
      {error && <p className="max-w-[220px] text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}

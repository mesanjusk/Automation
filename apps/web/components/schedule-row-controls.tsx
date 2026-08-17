"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { toggleSchedule, deleteSchedule } from "@/lib/actions/schedules";

export function ScheduleRowControls({ scheduleId, enabled }: { scheduleId: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <div className="flex justify-end gap-1.5">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(async () => { await toggleSchedule(scheduleId, !enabled); router.refresh(); })}
      >
        {enabled ? "Pause" : "Enable"}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={() => startTransition(async () => { await deleteSchedule(scheduleId); router.refresh(); })}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

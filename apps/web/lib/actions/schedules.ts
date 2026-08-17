"use server";

import { revalidatePath } from "next/cache";
import { dbConnect } from "@/lib/db";
import { Schedule } from "@bos/database";
import type { ScheduleFrequency } from "@bos/shared";

function computeNextRun(frequency: ScheduleFrequency, cronExpression?: string): Date {
  const now = new Date();
  switch (frequency) {
    case "HOURLY":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "DAILY":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "WEEKLY":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    default:
      return now; // ONCE / CRON: the scheduler process (see apps/worker README section) resolves the real next run
  }
}

export async function createSchedule(formData: FormData) {
  await dbConnect();
  const automationId = String(formData.get("automationId") ?? "");
  const frequency = String(formData.get("frequency") ?? "DAILY") as ScheduleFrequency;
  const cronExpression = String(formData.get("cronExpression") ?? "") || undefined;
  if (!automationId) throw new Error("Automation is required");

  await Schedule.create({
    automationId,
    frequency,
    cronExpression,
    nextRunAt: computeNextRun(frequency, cronExpression),
    enabled: true,
  });
  revalidatePath("/schedules");
}

export async function toggleSchedule(scheduleId: string, enabled: boolean) {
  await dbConnect();
  await Schedule.findByIdAndUpdate(scheduleId, { enabled });
  revalidatePath("/schedules");
}

export async function deleteSchedule(scheduleId: string) {
  await dbConnect();
  await Schedule.findByIdAndDelete(scheduleId);
  revalidatePath("/schedules");
}

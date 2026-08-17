import parser from "cron-parser";
import { Schedule, Automation, Workflow, Task } from "@bos/database";
import { enqueueAutomationTask } from "@bos/queue";

const CHECK_INTERVAL_MS = 60_000;

function computeNextRun(frequency: string, cronExpression: string | undefined, from: Date, timezone: string): Date {
  switch (frequency) {
    case "HOURLY":
      return new Date(from.getTime() + 60 * 60 * 1000);
    case "DAILY":
      return new Date(from.getTime() + 24 * 60 * 60 * 1000);
    case "WEEKLY":
      return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "CRON": {
      if (!cronExpression) return new Date(from.getTime() + 24 * 60 * 60 * 1000);
      const interval = parser.parseExpression(cronExpression, { currentDate: from, tz: timezone });
      return interval.next().toDate();
    }
    default:
      return from;
  }
}

/**
 * Polls the Schedule collection every minute and enqueues a task for any
 * schedule whose nextRunAt has passed. Deliberately simple (DB polling, not
 * a separate cron daemon) so the whole platform stays reachable with just
 * MongoDB + Redis — no extra infrastructure to deploy on Render.
 */
export function startScheduler(): NodeJS.Timeout {
  const tick = async () => {
    try {
      const due = await Schedule.find({ enabled: true, nextRunAt: { $lte: new Date() } });
      for (const schedule of due) {
        const automation = await Automation.findById(schedule.automationId);
        if (!automation || !automation.enabled) {
          schedule.nextRunAt = computeNextRun(schedule.frequency, schedule.cronExpression, new Date(), schedule.timezone);
          await schedule.save();
          continue;
        }
        const workflow = await Workflow.findById(automation.workflowId);
        if (!workflow?.publishedVersionId) {
          console.warn(`[scheduler] Skipping schedule ${schedule.id}: automation's workflow has no published version`);
          schedule.nextRunAt = computeNextRun(schedule.frequency, schedule.cronExpression, new Date(), schedule.timezone);
          await schedule.save();
          continue;
        }

        const task = await Task.create({
          automationId: automation._id,
          workflowId: workflow._id,
          workflowVersionId: workflow.publishedVersionId,
          status: "QUEUED",
          input: schedule.input,
          browserProfileId: automation.browserProfileId,
          callbackUrl: automation.callbackUrl,
          source: "schedule",
        });
        await enqueueAutomationTask(String(task._id));

        schedule.lastRunAt = new Date();
        if (schedule.frequency === "ONCE") {
          schedule.enabled = false;
        } else {
          schedule.nextRunAt = computeNextRun(schedule.frequency, schedule.cronExpression, new Date(), schedule.timezone);
        }
        await schedule.save();
        console.log(`[scheduler] Enqueued task ${task.id} for schedule ${schedule.id} (${automation.name})`);
      }
    } catch (err) {
      console.error("[scheduler] tick failed:", err);
    }
  };

  tick();
  return setInterval(tick, CHECK_INTERVAL_MS);
}

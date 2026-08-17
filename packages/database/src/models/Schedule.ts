import mongoose, { type Document, type Model, type Types } from "mongoose";
const { Schema, model, models } = mongoose;
import { SCHEDULE_FREQUENCIES, type ScheduleFrequency } from "@bos/shared";

export interface ISchedule extends Document {
  automationId: Types.ObjectId;
  frequency: ScheduleFrequency;
  cronExpression?: string;
  timezone: string;
  enabled: boolean;
  nextRunAt?: Date;
  lastRunAt?: Date;
  input: Record<string, unknown>;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ScheduleSchema = new Schema<ISchedule>(
  {
    automationId: { type: Schema.Types.ObjectId, ref: "Automation", required: true },
    frequency: { type: String, enum: SCHEDULE_FREQUENCIES, required: true },
    cronExpression: { type: String },
    timezone: { type: String, default: "UTC" },
    enabled: { type: Boolean, default: true },
    nextRunAt: { type: Date },
    lastRunAt: { type: Date },
    input: { type: Schema.Types.Mixed, default: {} },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);
ScheduleSchema.index({ automationId: 1 });
ScheduleSchema.index({ nextRunAt: 1 });

export const Schedule: Model<ISchedule> = models.Schedule || model<ISchedule>("Schedule", ScheduleSchema);

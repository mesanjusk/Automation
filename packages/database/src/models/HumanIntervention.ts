import { Schema, model, models, type Document, type Model, type Types } from "mongoose";
import { HUMAN_INTERVENTION_REASONS, type HumanInterventionReason } from "@bos/shared";

export interface IHumanIntervention extends Document {
  taskId: Types.ObjectId;
  stepId?: string;
  reason: HumanInterventionReason;
  message: string;
  screenshotId?: Types.ObjectId;
  status: "pending" | "approved" | "rejected" | "resolved";
  requestedAt: Date;
  resolvedAt?: Date;
  resolvedBy?: Types.ObjectId;
}

const HumanInterventionSchema = new Schema<IHumanIntervention>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    stepId: { type: String },
    reason: { type: String, enum: HUMAN_INTERVENTION_REASONS, required: true },
    message: { type: String, required: true },
    screenshotId: { type: Schema.Types.ObjectId, ref: "File" },
    status: { type: String, enum: ["pending", "approved", "rejected", "resolved"], default: "pending" },
    requestedAt: { type: Date, default: () => new Date() },
    resolvedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: false }
);
HumanInterventionSchema.index({ taskId: 1 });
HumanInterventionSchema.index({ status: 1 });

export const HumanIntervention: Model<IHumanIntervention> =
  models.HumanIntervention || model<IHumanIntervention>("HumanIntervention", HumanInterventionSchema);

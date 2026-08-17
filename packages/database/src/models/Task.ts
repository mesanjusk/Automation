import mongoose, { type Document, type Model, type Types } from "mongoose";
const { Schema, model, models } = mongoose;
import { TASK_STATUSES, type TaskStatus } from "@bos/shared";

export interface ITask extends Document {
  automationId: Types.ObjectId;
  workflowId: Types.ObjectId;
  workflowVersionId: Types.ObjectId;
  status: TaskStatus;
  priority: number;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  workerId?: string;
  browserProfileId?: Types.ObjectId;
  currentStepId?: string;
  variables: Record<string, unknown>;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  error?: Record<string, unknown>;
  retryCount: number;
  callbackUrl?: string;
  source: "api" | "dashboard" | "schedule";
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    automationId: { type: Schema.Types.ObjectId, ref: "Automation", required: true },
    workflowId: { type: Schema.Types.ObjectId, ref: "Workflow", required: true },
    workflowVersionId: { type: Schema.Types.ObjectId, ref: "WorkflowVersion", required: true },
    status: { type: String, enum: TASK_STATUSES, default: "QUEUED" },
    priority: { type: Number, default: 5 },
    input: { type: Schema.Types.Mixed, default: {} },
    output: { type: Schema.Types.Mixed },
    workerId: { type: String },
    browserProfileId: { type: Schema.Types.ObjectId, ref: "BrowserProfile" },
    currentStepId: { type: String },
    variables: { type: Schema.Types.Mixed, default: {} },
    startedAt: { type: Date },
    completedAt: { type: Date },
    duration: { type: Number },
    error: { type: Schema.Types.Mixed },
    retryCount: { type: Number, default: 0 },
    callbackUrl: { type: String },
    source: { type: String, enum: ["api", "dashboard", "schedule"], default: "dashboard" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

TaskSchema.index({ status: 1 });
TaskSchema.index({ automationId: 1 });
TaskSchema.index({ workflowId: 1 });
TaskSchema.index({ browserProfileId: 1 });
TaskSchema.index({ createdAt: -1 });

export const Task: Model<ITask> = models.Task || model<ITask>("Task", TaskSchema);

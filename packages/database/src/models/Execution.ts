import mongoose, { type Document, type Model, type Types } from "mongoose";
const { Schema, model, models } = mongoose;
import { EXECUTION_STEP_STATUSES, type ExecutionStepStatus } from "@bos/shared";

export interface IExecution extends Document {
  taskId: Types.ObjectId;
  attempt: number;
  status: "running" | "completed" | "failed" | "paused";
  startedAt: Date;
  completedAt?: Date;
  workerId?: string;
  createdAt: Date;
}

const ExecutionSchema = new Schema<IExecution>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    attempt: { type: Number, default: 1 },
    status: { type: String, enum: ["running", "completed", "failed", "paused"], default: "running" },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date },
    workerId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
ExecutionSchema.index({ taskId: 1, createdAt: -1 });

export const Execution: Model<IExecution> = models.Execution || model<IExecution>("Execution", ExecutionSchema);

export interface IExecutionStep extends Document {
  executionId: Types.ObjectId;
  taskId: Types.ObjectId;
  stepId: string; // workflow node id
  action: string; // node type
  name?: string;
  target?: string;
  selectorStrategyUsed?: string;
  status: ExecutionStepStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  duration?: number;
  screenshotId?: Types.ObjectId;
  timestamp: Date;
}

const ExecutionStepSchema = new Schema<IExecutionStep>(
  {
    executionId: { type: Schema.Types.ObjectId, ref: "Execution", required: true },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    stepId: { type: String, required: true },
    action: { type: String, required: true },
    name: { type: String },
    target: { type: String },
    selectorStrategyUsed: { type: String },
    status: { type: String, enum: EXECUTION_STEP_STATUSES, default: "PENDING" },
    input: { type: Schema.Types.Mixed },
    output: { type: Schema.Types.Mixed },
    error: { type: Schema.Types.Mixed },
    duration: { type: Number },
    screenshotId: { type: Schema.Types.ObjectId, ref: "File" },
    timestamp: { type: Date, default: () => new Date() },
  },
  { timestamps: false }
);
ExecutionStepSchema.index({ taskId: 1, timestamp: 1 });
ExecutionStepSchema.index({ executionId: 1 });

export const ExecutionStep: Model<IExecutionStep> =
  models.ExecutionStep || model<IExecutionStep>("ExecutionStep", ExecutionStepSchema);

import mongoose, { type Document, type Model, type Types } from "mongoose";
const { Schema, model, models } = mongoose;
import type { WorkflowDefinition } from "@bos/shared";

export type WorkflowStatus = "draft" | "published" | "archived";

export interface IWorkflow extends Document {
  name: string;
  description?: string;
  status: WorkflowStatus;
  currentVersion: number;
  publishedVersionId?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowSchema = new Schema<IWorkflow>(
  {
    name: { type: String, required: true },
    description: { type: String },
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft" },
    currentVersion: { type: Number, default: 0 },
    publishedVersionId: { type: Schema.Types.ObjectId, ref: "WorkflowVersion" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);
WorkflowSchema.index({ createdAt: -1 });

export const Workflow: Model<IWorkflow> = models.Workflow || model<IWorkflow>("Workflow", WorkflowSchema);

export interface IWorkflowVersion extends Document {
  workflowId: Types.ObjectId;
  version: number;
  definition: WorkflowDefinition;
  notes?: string;
  createdBy?: Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
}

const WorkflowVersionSchema = new Schema<IWorkflowVersion>(
  {
    workflowId: { type: Schema.Types.ObjectId, ref: "Workflow", required: true },
    version: { type: Number, required: true },
    definition: { type: Schema.Types.Mixed, required: true },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
WorkflowVersionSchema.index({ workflowId: 1, version: -1 }, { unique: true });

export const WorkflowVersion: Model<IWorkflowVersion> =
  models.WorkflowVersion || model<IWorkflowVersion>("WorkflowVersion", WorkflowVersionSchema);

import mongoose, { type Document, type Model, type Types } from "mongoose";
const { Schema, model, models } = mongoose;
import type { WorkflowDefinition } from "@bos/shared";

export type WorkflowStatus = "draft" | "published" | "archived";

export interface IWorkflow extends Document {
  name: string;
  description?: string;
  status: WorkflowStatus;
  currentVersion: number;
  /**
   * Set when this workflow was produced by a code generator rather than
   * hand-built in the editor (e.g. "video-studio"). Such a workflow has no life
   * of its own: it is a snapshot of what the generator emitted at the moment
   * the run started, so replaying it forever would pin the run to whatever the
   * code did that day. Retries regenerate it instead.
   */
  generator?: string;
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
    generator: { type: String },
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

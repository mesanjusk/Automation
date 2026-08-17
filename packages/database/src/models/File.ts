import mongoose, { type Document, type Model, type Types } from "mongoose";
const { Schema, model, models } = mongoose;
import { FILE_PROVIDERS, type FileProvider } from "@bos/shared";

export interface IFile extends Document {
  name: string;
  mimeType: string;
  size: number;
  provider: FileProvider;
  url: string;
  storageKey: string;
  kind: "screenshot" | "download" | "upload" | "generated";
  taskId?: Types.ObjectId;
  executionStepId?: Types.ObjectId;
  createdAt: Date;
}

const FileSchema = new Schema<IFile>(
  {
    name: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    provider: { type: String, enum: FILE_PROVIDERS, required: true },
    url: { type: String, required: true },
    storageKey: { type: String, required: true },
    kind: { type: String, enum: ["screenshot", "download", "upload", "generated"], default: "generated" },
    taskId: { type: Schema.Types.ObjectId, ref: "Task" },
    executionStepId: { type: Schema.Types.ObjectId, ref: "ExecutionStep" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
FileSchema.index({ taskId: 1 });
FileSchema.index({ createdAt: -1 });

export const File: Model<IFile> = models.File || model<IFile>("File", FileSchema);

import mongoose, { type Document, type Model, type Types } from "mongoose";
const { Schema, model, models } = mongoose;

export interface IAIRequest extends Document {
  taskId: Types.ObjectId;
  stepId?: string;
  provider: string;
  // Named modelName (not "model") to avoid colliding with Mongoose Document's
  // own built-in .model() method.
  modelName: string;
  prompt: string;
  response?: string;
  action?: Record<string, unknown>;
  tokensUsed?: number;
  latencyMs?: number;
  error?: string;
  createdAt: Date;
}

const AIRequestSchema = new Schema<IAIRequest>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    stepId: { type: String },
    provider: { type: String, required: true },
    modelName: { type: String, required: true },
    prompt: { type: String, required: true },
    response: { type: String },
    action: { type: Schema.Types.Mixed },
    tokensUsed: { type: Number },
    latencyMs: { type: Number },
    error: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
AIRequestSchema.index({ taskId: 1 });

export const AIRequest: Model<IAIRequest> = models.AIRequest || model<IAIRequest>("AIRequest", AIRequestSchema);

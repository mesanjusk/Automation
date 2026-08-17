import { Schema, model, models, type Document, type Model, type Types } from "mongoose";

export interface IAutomation extends Document {
  name: string;
  description?: string;
  slug: string;
  status: "active" | "disabled" | "draft";
  workflowId: Types.ObjectId;
  browserProfileId?: Types.ObjectId;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  scheduleId?: Types.ObjectId;
  enabled: boolean;
  callbackUrl?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AutomationSchema = new Schema<IAutomation>(
  {
    name: { type: String, required: true },
    description: { type: String },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: { type: String, enum: ["active", "disabled", "draft"], default: "draft" },
    workflowId: { type: Schema.Types.ObjectId, ref: "Workflow", required: true },
    browserProfileId: { type: Schema.Types.ObjectId, ref: "BrowserProfile" },
    inputSchema: { type: Schema.Types.Mixed },
    outputSchema: { type: Schema.Types.Mixed },
    scheduleId: { type: Schema.Types.ObjectId, ref: "Schedule" },
    enabled: { type: Boolean, default: true },
    callbackUrl: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);
AutomationSchema.index({ workflowId: 1 });
AutomationSchema.index({ createdAt: -1 });

export const Automation: Model<IAutomation> =
  models.Automation || model<IAutomation>("Automation", AutomationSchema);

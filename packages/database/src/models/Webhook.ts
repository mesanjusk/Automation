import { Schema, model, models, type Document, type Model, type Types } from "mongoose";

export interface IWebhook extends Document {
  name: string;
  url: string;
  events: string[];
  secret?: string;
  automationId?: Types.ObjectId;
  enabled: boolean;
  lastDeliveryAt?: Date;
  lastDeliveryStatus?: "success" | "failed";
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookSchema = new Schema<IWebhook>(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    events: { type: [String], default: ["automation.completed", "automation.failed"] },
    secret: { type: String, select: false },
    automationId: { type: Schema.Types.ObjectId, ref: "Automation" },
    enabled: { type: Boolean, default: true },
    lastDeliveryAt: { type: Date },
    lastDeliveryStatus: { type: String, enum: ["success", "failed"] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Webhook: Model<IWebhook> = models.Webhook || model<IWebhook>("Webhook", WebhookSchema);

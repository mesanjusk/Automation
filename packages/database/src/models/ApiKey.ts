import { Schema, model, models, type Document, type Model, type Types } from "mongoose";

export interface IApiKey extends Document {
  name: string;
  prefix: string; // first 8 chars shown in UI, e.g. "bos_live_ab12cd34"
  hashedKey: string; // sha256 hash of the full key, never store plaintext
  scopes: string[];
  revoked: boolean;
  lastUsedAt?: Date;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}

const ApiKeySchema = new Schema<IApiKey>(
  {
    name: { type: String, required: true },
    prefix: { type: String, required: true },
    hashedKey: { type: String, required: true, unique: true, select: false },
    scopes: { type: [String], default: ["automations:run", "tasks:read", "tasks:write"] },
    revoked: { type: Boolean, default: false },
    lastUsedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const ApiKey: Model<IApiKey> = models.ApiKey || model<IApiKey>("ApiKey", ApiKeySchema);

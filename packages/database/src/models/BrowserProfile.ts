import { Schema, model, models, type Document, type Model, type Types } from "mongoose";

export interface IBrowserProfile extends Document {
  name: string;
  description?: string;
  userAgent?: string;
  viewport: { width: number; height: number };
  locale?: string;
  timezone?: string;
  // AES-256-GCM encrypted JSON blob of Playwright storageState (cookies +
  // localStorage). Never stored or logged in plaintext.
  encryptedStorageState?: string;
  status: "empty" | "ready" | "in_use" | "expired";
  lastUsedAt?: Date;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BrowserProfileSchema = new Schema<IBrowserProfile>(
  {
    name: { type: String, required: true },
    description: { type: String },
    userAgent: { type: String },
    viewport: {
      width: { type: Number, default: 1440 },
      height: { type: Number, default: 900 },
    },
    locale: { type: String, default: "en-US" },
    timezone: { type: String, default: "UTC" },
    encryptedStorageState: { type: String, select: false },
    status: { type: String, enum: ["empty", "ready", "in_use", "expired"], default: "empty" },
    lastUsedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const BrowserProfile: Model<IBrowserProfile> =
  models.BrowserProfile || model<IBrowserProfile>("BrowserProfile", BrowserProfileSchema);

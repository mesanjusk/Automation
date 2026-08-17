import { Schema, model, models, type Document, type Model, type Types } from "mongoose";

export interface ICredential extends Document {
  name: string;
  type: "password" | "api_key" | "totp_seed" | "generic";
  browserProfileId?: Types.ObjectId;
  encryptedValue: string; // AES-256-GCM, never returned in API responses
  metadata?: Record<string, unknown>; // non-sensitive only (e.g. username, site)
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CredentialSchema = new Schema<ICredential>(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ["password", "api_key", "totp_seed", "generic"], default: "password" },
    browserProfileId: { type: Schema.Types.ObjectId, ref: "BrowserProfile" },
    encryptedValue: { type: String, required: true, select: false },
    metadata: { type: Schema.Types.Mixed },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Credential: Model<ICredential> =
  models.Credential || model<ICredential>("Credential", CredentialSchema);

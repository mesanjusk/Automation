import mongoose, { type Document, type Model } from "mongoose";
const { Schema, model, models } = mongoose;

export type UserRole = "admin" | "operator" | "viewer";

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  externalId?: string; // for future CRM auth linkage
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["admin", "operator", "viewer"], default: "operator" },
    externalId: { type: String },
  },
  { timestamps: true }
);

export const User: Model<IUser> = models.User || model<IUser>("User", UserSchema);

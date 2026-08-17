import { Schema, model, models, type Document, type Model, type Types } from "mongoose";

export interface IAuditLog extends Document {
  actorType: "user" | "api_key" | "system";
  actorId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorType: { type: String, enum: ["user", "api_key", "system"], required: true },
    actorId: { type: String },
    action: { type: String, required: true },
    resourceType: { type: String },
    resourceId: { type: String },
    metadata: { type: Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ actorId: 1 });

export const AuditLog: Model<IAuditLog> = models.AuditLog || model<IAuditLog>("AuditLog", AuditLogSchema);

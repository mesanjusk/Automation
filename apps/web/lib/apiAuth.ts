import "server-only";
import { NextResponse } from "next/server";
import { dbConnect } from "./db";
import { ApiKey, AuditLog } from "@bos/database";
import { hashApiKey, checkRateLimit } from "@bos/security";

const RATE_LIMIT = Number(process.env.API_RATE_LIMIT ?? 60);
const RATE_WINDOW_MS = 60_000;

export interface ApiAuthContext {
  apiKeyId: string;
  scopes: string[];
}

export async function authenticateApiRequest(req: Request): Promise<{ ctx: ApiAuthContext } | { error: NextResponse }> {
  const rawKey = req.headers.get("x-api-key");
  if (!rawKey) {
    return { error: NextResponse.json({ error: "Missing X-API-Key header" }, { status: 401 }) };
  }

  await dbConnect();
  const hashed = hashApiKey(rawKey);
  const apiKey = await ApiKey.findOne({ hashedKey: hashed });
  if (!apiKey || apiKey.revoked) {
    return { error: NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 }) };
  }

  const rate = checkRateLimit(String(apiKey._id), RATE_LIMIT, RATE_WINDOW_MS);
  if (!rate.allowed) {
    return {
      error: NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } }
      ),
    };
  }

  apiKey.lastUsedAt = new Date();
  await apiKey.save();

  return { ctx: { apiKeyId: String(apiKey._id), scopes: apiKey.scopes } };
}

export async function auditApiAction(apiKeyId: string, action: string, resourceType?: string, resourceId?: string): Promise<void> {
  await AuditLog.create({ actorType: "api_key", actorId: apiKeyId, action, resourceType, resourceId });
}

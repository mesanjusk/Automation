import crypto from "node:crypto";

const KEY_PREFIX = "bos_live_";

export function generateApiKey(): { rawKey: string; hashedKey: string; prefix: string } {
  const rawKey = `${KEY_PREFIX}${crypto.randomBytes(24).toString("hex")}`;
  return { rawKey, hashedKey: hashApiKey(rawKey), prefix: rawKey.slice(0, 16) };
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function isValidApiKeyFormat(rawKey: string): boolean {
  return rawKey.startsWith(KEY_PREFIX) && rawKey.length > KEY_PREFIX.length + 20;
}

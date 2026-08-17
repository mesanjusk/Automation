import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes). Generate one with: openssl rand -hex 32"
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypts arbitrary text (credentials, cookies, storageState JSON) with
 * AES-256-GCM. Output is a single base64 string: iv + authTag + ciphertext.
 * This is the ONLY place plaintext secrets should ever be held in memory
 * longer than necessary — callers must never log the input.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decrypt(payload: string): string {
  const key = getKey();
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = raw.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function encryptJSON(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJSON<T = unknown>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T;
}

/** Deterministic redaction for anything that might slip into a log/prompt. */
export function redactSecrets(input: string, secrets: (string | undefined)[]): string {
  let out = input;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

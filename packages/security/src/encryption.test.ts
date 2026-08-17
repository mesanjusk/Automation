import { describe, expect, it, beforeAll } from "vitest";
import crypto from "node:crypto";

describe("encryption", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  });

  it("round-trips plaintext through encrypt/decrypt", async () => {
    const { encrypt, decrypt } = await import("./encryption.js");
    const secret = "correct horse battery staple";
    const encrypted = encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(decrypt(encrypted)).toBe(secret);
  });

  it("round-trips JSON payloads", async () => {
    const { encryptJSON, decryptJSON } = await import("./encryption.js");
    const payload = { cookies: [{ name: "session", value: "abc123" }] };
    const encrypted = encryptJSON(payload);
    expect(decryptJSON(encrypted)).toEqual(payload);
  });

  it("produces different ciphertext for the same plaintext (random IV)", async () => {
    const { encrypt } = await import("./encryption.js");
    expect(encrypt("same input")).not.toBe(encrypt("same input"));
  });

  it("redacts secrets from a log-like string", async () => {
    const { redactSecrets } = await import("./encryption.js");
    const out = redactSecrets("password=hunter2 sent to server", ["hunter2"]);
    expect(out).not.toContain("hunter2");
    expect(out).toContain("[REDACTED]");
  });
});

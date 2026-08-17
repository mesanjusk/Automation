import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, isValidApiKeyFormat } from "./apiKeys.js";

describe("apiKeys", () => {
  it("generates a key whose hash matches hashApiKey(rawKey)", () => {
    const { rawKey, hashedKey } = generateApiKey();
    expect(hashApiKey(rawKey)).toBe(hashedKey);
  });

  it("never returns the raw key equal to its hash", () => {
    const { rawKey, hashedKey } = generateApiKey();
    expect(rawKey).not.toBe(hashedKey);
  });

  it("produces a valid-format key", () => {
    const { rawKey } = generateApiKey();
    expect(isValidApiKeyFormat(rawKey)).toBe(true);
  });

  it("rejects malformed keys", () => {
    expect(isValidApiKeyFormat("not-a-key")).toBe(false);
    expect(isValidApiKeyFormat("bos_live_short")).toBe(false);
  });

  it("produces distinct keys on each call", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.rawKey).not.toBe(b.rawKey);
    expect(a.hashedKey).not.toBe(b.hashedKey);
  });
});

import { describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry";
import { AutomationError } from "@bos/shared";

const policy = (overrides: Partial<Parameters<typeof withRetry>[1]> = {}) => ({
  maxRetries: 2,
  delayMs: 1,
  exponentialBackoff: false,
  maxDelayMs: 100,
  ...overrides,
});

describe("withRetry", () => {
  it("returns the result immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const outcome = await withRetry(fn, policy());
    expect(outcome.result).toBe("ok");
    expect(outcome.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure until it succeeds", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error("Navigation timeout exceeded");
      return "recovered";
    });
    const outcome = await withRetry(fn, policy());
    expect(outcome.result).toBe("recovered");
    expect(outcome.attempts).toBe(3);
  });

  it("gives up after maxRetries + 1 attempts and surfaces the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("net::ERR_CONNECTION_RESET"));
    const outcome = await withRetry(fn, policy({ maxRetries: 2 }));
    expect(outcome.result).toBeUndefined();
    expect(outcome.attempts).toBe(3);
    expect(outcome.error).toBeInstanceOf(Error);
  });

  it("does not retry a non-retryable AutomationError, even once", async () => {
    const fn = vi.fn().mockRejectedValue(
      new AutomationError({ errorCode: "AUTH_FAILED", message: "Invalid credentials", category: "AUTHENTICATION", retryable: false })
    );
    const outcome = await withRetry(fn, policy({ maxRetries: 5 }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(outcome.attempts).toBe(1);
  });

  it("retries a retryable AutomationError up to the policy limit", async () => {
    const fn = vi.fn().mockRejectedValue(
      new AutomationError({ errorCode: "FLAKY", message: "temporary glitch", category: "TRANSIENT", retryable: true })
    );
    const outcome = await withRetry(fn, policy({ maxRetries: 1 }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls onRetry with the attempt number and the error", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce("ok");
    await withRetry(fn, policy(), onRetry);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { deliverWebhook } from "./webhookDelivery";

describe("deliverWebhook", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs the JSON payload and succeeds on a 2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await deliverWebhook("https://crm.example.com/hook", { event: "automation.completed" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://crm.example.com/hook");
    expect(JSON.parse(init.body)).toEqual({ event: "automation.completed" });
  });

  it("signs the payload with HMAC-SHA256 when a secret is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const payload = { event: "automation.failed" };
    await deliverWebhook("https://crm.example.com/hook", payload, "shhh");

    const [, init] = fetchMock.mock.calls[0]!;
    const expectedSignature = crypto.createHmac("sha256", "shhh").update(JSON.stringify(payload)).digest("hex");
    expect(init.headers["X-BOS-Signature"]).toBe(expectedSignature);
  });

  it("omits the signature header when no secret is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await deliverWebhook("https://crm.example.com/hook", { event: "x" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers["X-BOS-Signature"]).toBeUndefined();
  });

  it("throws when the receiving endpoint responds with a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(deliverWebhook("https://crm.example.com/hook", { event: "x" })).rejects.toThrow(/failed with status 500/);
  });
});

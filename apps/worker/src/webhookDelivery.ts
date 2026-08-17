import crypto from "node:crypto";
import type { WebhookEvent } from "@bos/shared";

/**
 * Delivers a webhook to a CRM (or any subscriber). Signs the payload with
 * HMAC-SHA256 when a secret is configured so receivers can verify
 * authenticity, mirroring common webhook conventions (Stripe/GitHub-style).
 */
export async function deliverWebhook(url: string, payload: WebhookEvent | Record<string, unknown>, secret?: string): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) {
    headers["X-BOS-Signature"] = crypto.createHmac("sha256", secret).update(body).digest("hex");
  }
  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) {
    throw new Error(`Webhook delivery to ${url} failed with status ${res.status}`);
  }
}

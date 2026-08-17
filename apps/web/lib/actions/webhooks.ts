"use server";

import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { dbConnect } from "@/lib/db";
import { Webhook } from "@bos/database";

export async function createWebhook(formData: FormData) {
  await dbConnect();
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const events = formData.getAll("events").map(String);
  if (!name || !url) throw new Error("Name and URL are required");

  await Webhook.create({
    name,
    url,
    events: events.length ? events : ["automation.completed", "automation.failed"],
    secret: crypto.randomBytes(16).toString("hex"),
    enabled: true,
  });
  revalidatePath("/webhooks");
}

export async function toggleWebhook(webhookId: string, enabled: boolean) {
  await dbConnect();
  await Webhook.findByIdAndUpdate(webhookId, { enabled });
  revalidatePath("/webhooks");
}

export async function deleteWebhook(webhookId: string) {
  await dbConnect();
  await Webhook.findByIdAndDelete(webhookId);
  revalidatePath("/webhooks");
}

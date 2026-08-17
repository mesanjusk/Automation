"use server";

import { revalidatePath } from "next/cache";
import { dbConnect } from "@/lib/db";
import { ApiKey } from "@bos/database";
import { generateApiKey } from "@bos/security";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function createApiKey(formData: FormData): Promise<string> {
  await dbConnect();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required");

  const session = await getServerSession(authOptions);
  const { rawKey, hashedKey, prefix } = generateApiKey();
  await ApiKey.create({
    name,
    prefix,
    hashedKey,
    createdBy: (session?.user as unknown as { id?: string })?.id,
  });
  revalidatePath("/api");
  return rawKey; // shown to the user exactly once
}

export async function revokeApiKey(apiKeyId: string) {
  await dbConnect();
  await ApiKey.findByIdAndUpdate(apiKeyId, { revoked: true });
  revalidatePath("/api");
}

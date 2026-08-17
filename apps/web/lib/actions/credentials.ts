"use server";

import { revalidatePath } from "next/cache";
import { dbConnect } from "@/lib/db";
import { Credential } from "@bos/database";
import { encrypt } from "@bos/security";

export async function createCredential(formData: FormData) {
  await dbConnect();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "password") as "password" | "api_key" | "totp_seed" | "generic";
  const value = String(formData.get("value") ?? "");
  const browserProfileId = String(formData.get("browserProfileId") ?? "") || undefined;
  const username = String(formData.get("username") ?? "") || undefined;
  if (!name || !value) throw new Error("Name and value are required");

  await Credential.create({
    name,
    type,
    browserProfileId,
    encryptedValue: encrypt(value),
    metadata: username ? { username } : undefined,
  });
  revalidatePath("/credentials");
}

export async function deleteCredential(credentialId: string) {
  await dbConnect();
  await Credential.findByIdAndDelete(credentialId);
  revalidatePath("/credentials");
}

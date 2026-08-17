"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbConnect } from "@/lib/db";
import { BrowserProfile, AuditLog } from "@bos/database";
import { encryptJSON, decryptJSON } from "@bos/security";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function createProfile(formData: FormData) {
  await dbConnect();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const userAgent = String(formData.get("userAgent") ?? "").trim() || undefined;
  const locale = String(formData.get("locale") ?? "en-US");
  const timezone = String(formData.get("timezone") ?? "UTC");
  const width = Number(formData.get("width") ?? 1440);
  const height = Number(formData.get("height") ?? 900);
  if (!name) throw new Error("Name is required");

  const profile = await BrowserProfile.create({
    name,
    description,
    userAgent,
    locale,
    timezone,
    viewport: { width, height },
    status: "empty",
  });

  revalidatePath("/profiles");
  redirect(`/profiles?created=${profile._id}`);
}

export async function deleteProfile(profileId: string) {
  await dbConnect();
  await BrowserProfile.findByIdAndDelete(profileId);
  revalidatePath("/profiles");
}

export async function renameProfile(profileId: string, name: string) {
  await dbConnect();
  await BrowserProfile.findByIdAndUpdate(profileId, { name });
  revalidatePath("/profiles");
}

/**
 * Exports the profile's decrypted Playwright storageState (cookies +
 * localStorage) so it can be imported into another environment. This is a
 * privileged, audited action — only reachable from the authenticated
 * dashboard — and the value is never logged.
 */
export async function exportSession(profileId: string): Promise<string> {
  await dbConnect();
  const profile = await BrowserProfile.findById(profileId).select("+encryptedStorageState");
  if (!profile?.encryptedStorageState) throw new Error("This profile has no saved session yet");

  const session = await getServerSession(authOptions);
  await AuditLog.create({ actorType: "user", actorId: session?.user?.email, action: "profile.export_session", resourceType: "BrowserProfile", resourceId: profileId });

  return JSON.stringify(decryptJSON(profile.encryptedStorageState), null, 2);
}

export async function importSession(profileId: string, storageStateJson: string) {
  await dbConnect();
  let parsed: unknown;
  try {
    parsed = JSON.parse(storageStateJson);
  } catch {
    throw new Error("Invalid JSON");
  }
  const profile = await BrowserProfile.findById(profileId);
  if (!profile) throw new Error("Profile not found");
  profile.encryptedStorageState = encryptJSON(parsed);
  profile.status = "ready";
  await profile.save();

  const session = await getServerSession(authOptions);
  await AuditLog.create({ actorType: "user", actorId: session?.user?.email, action: "profile.import_session", resourceType: "BrowserProfile", resourceId: profileId });

  revalidatePath("/profiles");
}

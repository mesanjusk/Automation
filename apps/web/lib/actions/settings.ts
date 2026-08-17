"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { User } from "@bos/database";
import { hashPassword, verifyPassword } from "@bos/security";

export async function changePassword(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, message: "Not signed in" };

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  if (newPassword.length < 8) return { ok: false, message: "New password must be at least 8 characters" };

  await dbConnect();
  const user = await User.findOne({ email: session.user.email }).select("+passwordHash");
  if (!user) return { ok: false, message: "User not found" };

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) return { ok: false, message: "Current password is incorrect" };

  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  return { ok: true, message: "Password updated" };
}

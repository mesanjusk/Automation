import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { User } from "@bos/database";
import { hashPassword } from "@bos/security";

// One-time bootstrap: creates the first admin user so there's a way to log
// in on a fresh deployment (no self-serve signup page exists by design).
// Self-limiting: once any User document exists, this always 404s, so it
// can't be used to mint additional accounts later.
export async function POST() {
  await dbConnect();

  const existing = await User.countDocuments();
  if (existing > 0) {
    return NextResponse.json({ error: "Setup already completed" }, { status: 404 });
  }

  const email = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";
  const passwordHash = await hashPassword(password);
  await User.create({ name: "Admin", email, passwordHash, role: "admin" });

  return NextResponse.json({ ok: true, email });
}

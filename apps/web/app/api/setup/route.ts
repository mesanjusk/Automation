import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { User } from "@bos/database";
import { hashPassword } from "@bos/security";

// Mutates state on every hit, so it must never be cached by the browser or
// any intermediary — without this, a GET can appear to "succeed" repeatedly
// from a cached response without the server having run again.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// One-time bootstrap: creates the first admin user so there's a way to log
// in on a fresh deployment (no self-serve signup page exists by design).
// Self-limiting: once any User document exists, this always 404s, so it
// can't be used to mint additional accounts later. Answers GET too (in
// addition to POST) purely so it can be triggered by opening the URL in a
// browser — the idempotent guard above is what actually keeps this safe,
// not the HTTP method.
async function runSetup() {
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

export const POST = runSetup;
export const GET = runSetup;

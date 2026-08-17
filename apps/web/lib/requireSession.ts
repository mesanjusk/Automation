import "server-only";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./auth";

/** Guards internal dashboard API routes (distinct from the API-key-protected /api/v1/* routes). */
export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { session: null, unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session, unauthorized: null };
}

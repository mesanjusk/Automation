import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { requireSession } from "@/lib/requireSession";

const BASE_DIR = process.env.LOCAL_STORAGE_DIR || "./storage/local";

export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  const { unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  const relativePath = params.key.join("/");
  const resolved = path.resolve(BASE_DIR, relativePath);
  const baseResolved = path.resolve(BASE_DIR);
  if (!resolved.startsWith(baseResolved)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const buffer = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
    return new NextResponse(buffer, { headers: { "Content-Type": mimeType, "Cache-Control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}

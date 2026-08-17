import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";
import { dbConnect } from "@/lib/db";
import { Automation } from "@bos/database";

export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return auth.error;

  await dbConnect();
  const automations = await Automation.find({ enabled: true }).select("name description slug status createdAt").lean();
  return NextResponse.json({
    automations: automations.map((a) => ({
      id: String(a._id),
      name: a.name,
      description: a.description,
      slug: a.slug,
      status: a.status,
      createdAt: a.createdAt,
    })),
  });
}

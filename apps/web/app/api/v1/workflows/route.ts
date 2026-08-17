import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";
import { dbConnect } from "@/lib/db";
import { Workflow } from "@bos/database";

export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return auth.error;

  await dbConnect();
  const workflows = await Workflow.find().select("name description status currentVersion publishedVersionId").lean();
  return NextResponse.json({
    workflows: workflows.map((w) => ({
      id: String(w._id),
      name: w.name,
      description: w.description,
      status: w.status,
      currentVersion: w.currentVersion,
      published: !!w.publishedVersionId,
    })),
  });
}

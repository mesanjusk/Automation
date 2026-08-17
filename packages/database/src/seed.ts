// Bootstraps a local dev database: one admin user + one API key.
// Run with: npm run seed --workspace=packages/database
import "dotenv/config";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { connectToDatabase, disconnectDatabase } from "./connection";
import { User, ApiKey } from "./models/index";

async function main() {
  await connectToDatabase();

  const email = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";

  let admin = await User.findOne({ email });
  if (!admin) {
    const passwordHash = await bcrypt.hash(password, 12);
    admin = await User.create({ name: "Admin", email, passwordHash, role: "admin" });
    console.log(`Created admin user ${email} / ${password} (change this immediately)`);
  } else {
    console.log(`Admin user ${email} already exists`);
  }

  const existingKey = await ApiKey.findOne({ name: "bootstrap" });
  if (!existingKey) {
    const rawKey = `bos_live_${crypto.randomBytes(24).toString("hex")}`;
    const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");
    await ApiKey.create({
      name: "bootstrap",
      prefix: rawKey.slice(0, 16),
      hashedKey,
      scopes: ["automations:run", "tasks:read", "tasks:write", "workflows:read"],
      createdBy: admin._id,
    });
    console.log(`Created bootstrap API key: ${rawKey}`);
    console.log("Store this in your CRM's config now — it will not be shown again.");
  } else {
    console.log("Bootstrap API key already exists");
  }

  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

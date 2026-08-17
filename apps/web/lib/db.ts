import "server-only";
import { connectToDatabase } from "@bos/database";

// Thin re-export so every server component/action just does `await dbConnect()`.
export async function dbConnect() {
  return connectToDatabase();
}

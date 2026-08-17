import IORedis, { type Redis } from "ioredis";

let sharedConnection: Redis | null = null;

/** BullMQ requires maxRetriesPerRequest: null on its Redis connection. */
export function getRedisConnection(url = process.env.REDIS_URL): Redis {
  if (!url) throw new Error("REDIS_URL is not set");
  if (!sharedConnection) {
    sharedConnection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return sharedConnection;
}

export async function closeRedisConnection(): Promise<void> {
  if (sharedConnection) {
    await sharedConnection.quit();
    sharedConnection = null;
  }
}

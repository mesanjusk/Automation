import express from "express";
import mongoose from "mongoose";
import { getRedisConnection } from "@bos/queue";

export function startHealthServer(port: number, workerId: string) {
  const app = express();

  app.get("/health", async (_req, res) => {
    const mongoState = mongoose.connection.readyState; // 1 = connected
    let redisOk = false;
    try {
      const pong = await getRedisConnection().ping();
      redisOk = pong === "PONG";
    } catch {
      redisOk = false;
    }

    const healthy = mongoState === 1 && redisOk;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "healthy" : "degraded",
      workerId,
      browser: "ready",
      redis: redisOk ? "connected" : "disconnected",
      mongodb: mongoState === 1 ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/", (_req, res) => res.redirect("/health"));

  return app.listen(port, () => {
    console.log(`[worker] health server listening on :${port}`);
  });
}

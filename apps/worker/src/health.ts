import express from "express";
import mongoose from "mongoose";

export function startHealthServer(port: number, workerId: string, target: "render" | "local" = "render") {
  const app = express();

  app.get("/health", async (_req, res) => {
    const mongoState = mongoose.connection.readyState; // 1 = connected
    // A local worker claims tasks straight from MongoDB, so Redis being down
    // (or absent entirely) says nothing about whether it is healthy.
    let redisOk: boolean | null = null;
    if (target === "render") {
      try {
        const { getRedisConnection } = await import("@bos/queue");
        redisOk = (await getRedisConnection().ping()) === "PONG";
      } catch {
        redisOk = false;
      }
    }

    const healthy = mongoState === 1 && redisOk !== false;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "healthy" : "degraded",
      workerId,
      target,
      browser: "ready",
      redis: redisOk === null ? "not required" : redisOk ? "connected" : "disconnected",
      mongodb: mongoState === 1 ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/", (_req, res) => res.redirect("/health"));

  return app.listen(port, () => {
    console.log(`[worker] health server listening on :${port}`);
  });
}

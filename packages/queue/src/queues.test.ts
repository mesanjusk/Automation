import { describe, expect, it, vi, beforeEach } from "vitest";

const addMock = vi.fn().mockResolvedValue({ id: "job-1" });

vi.mock("ioredis", () => ({
  default: class FakeRedis {
    constructor(_url?: string, _opts?: unknown) {}
    quit() {
      return Promise.resolve();
    }
  },
}));

vi.mock("bullmq", () => ({
  Queue: class FakeQueue {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
    add(...args: unknown[]) {
      return addMock(this.name, ...args);
    }
  },
  QueueEvents: class FakeQueueEvents {},
}));

process.env.REDIS_URL = "redis://localhost:6379";

const { enqueueAutomationTask, enqueueWebhook } = await import("./queues.js");

beforeEach(() => addMock.mockClear());

describe("queue producers", () => {
  it("enqueues a task onto the automation-tasks queue with the right job data", async () => {
    await enqueueAutomationTask("task-123");
    expect(addMock).toHaveBeenCalledWith(
      "automation-tasks",
      "run-task",
      { taskId: "task-123" },
      expect.objectContaining({ attempts: 1 })
    );
  });

  it("passes priority and delay through to BullMQ when provided", async () => {
    await enqueueAutomationTask("task-456", { priority: 1, delay: 5000 });
    expect(addMock).toHaveBeenCalledWith(
      "automation-tasks",
      "run-task",
      { taskId: "task-456" },
      expect.objectContaining({ priority: 1, delay: 5000 })
    );
  });

  it("enqueues webhook deliveries with retry backoff configured", async () => {
    await enqueueWebhook({ webhookUrl: "https://crm.example.com/hook", payload: { event: "automation.completed" } });
    expect(addMock).toHaveBeenCalledWith(
      "webhooks",
      "deliver",
      { webhookUrl: "https://crm.example.com/hook", payload: { event: "automation.completed" } },
      expect.objectContaining({ attempts: 5, backoff: { type: "exponential", delay: 2000 } })
    );
  });
});

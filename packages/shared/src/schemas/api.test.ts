import { describe, expect, it } from "vitest";
import { runAutomationRequestSchema, webhookEventSchema } from "./api";

describe("runAutomationRequestSchema (validates POST /api/v1/automations/run bodies)", () => {
  it("accepts a minimal valid request", () => {
    const parsed = runAutomationRequestSchema.parse({ automation: "supplier-stock-check" });
    expect(parsed.automation).toBe("supplier-stock-check");
    expect(parsed.input).toEqual({});
  });

  it("accepts a full request with input and callback", () => {
    const parsed = runAutomationRequestSchema.parse({
      automation: "supplier-stock-check",
      input: { products: ["P001", "P002"] },
      callbackUrl: "https://crm.example.com/api/automation/callback",
      priority: 3,
    });
    expect(parsed.input.products).toEqual(["P001", "P002"]);
  });

  it("rejects a request missing the automation reference", () => {
    expect(() => runAutomationRequestSchema.parse({ input: {} })).toThrow();
  });

  it("rejects an invalid callbackUrl", () => {
    expect(() => runAutomationRequestSchema.parse({ automation: "x", callbackUrl: "not-a-url" })).toThrow();
  });

  it("rejects a priority outside 1-10", () => {
    expect(() => runAutomationRequestSchema.parse({ automation: "x", priority: 99 })).toThrow();
  });
});

describe("webhookEventSchema", () => {
  it("accepts a well-formed completed event", () => {
    const parsed = webhookEventSchema.parse({
      event: "automation.completed",
      automationId: "abc",
      taskId: "def",
      status: "COMPLETED",
      result: { price: "$12" },
      files: [],
      timestamp: new Date().toISOString(),
    });
    expect(parsed.event).toBe("automation.completed");
  });

  it("rejects an unknown event name", () => {
    expect(() =>
      webhookEventSchema.parse({ event: "automation.exploded", automationId: "a", taskId: "b", status: "x", timestamp: "now" })
    ).toThrow();
  });
});

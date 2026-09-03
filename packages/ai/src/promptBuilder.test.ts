import { describe, expect, it } from "vitest";
import { buildAgentPrompt, buildWorkflowGenerationPrompt } from "./promptBuilder";
import { AGENT_TOOLS, type AgentContext } from "@bos/shared";

function context(partial: Partial<AgentContext> = {}): AgentContext {
  return {
    goal: "Download the latest invoice",
    page: {
      url: "https://billing.test/invoices",
      title: "Invoices",
      visibleText: "Invoice 2026-04 — £120.00",
      outline: '[e1] link "Invoice 2026-04" -> /i/1\n[e2] button "Download" (disabled)',
      notices: [],
      scroll: { y: 0, height: 900, viewport: 900, atBottom: true },
    },
    variables: {},
    previousActions: [],
    actionsSoFar: 0,
    maxActions: 100,
    ...partial,
  };
}

describe("buildAgentPrompt", () => {
  it("shows the ref-labelled controls, which is what the agent acts on", () => {
    const prompt = buildAgentPrompt(context());
    expect(prompt).toContain('[e1] link "Invoice 2026-04"');
    expect(prompt).toContain("CONTROLS (act on these by ref)");
  });

  it("tells the agent to address elements by ref and not to reuse old ones", () => {
    const prompt = buildAgentPrompt(context());
    expect(prompt).toContain("ADDRESS ELEMENTS BY REF");
    expect(prompt).toMatch(/Refs from earlier turns may be stale/);
  });

  it("documents every tool the agent is actually allowed to call", () => {
    const prompt = buildAgentPrompt(context());
    for (const tool of AGENT_TOOLS) {
      expect(prompt).toContain(tool);
    }
  });

  it("puts what changed in front of the agent, not just the new page", () => {
    // Without this the model cannot tell a click that worked from one that did
    // nothing, and it will build its next three steps on an action that never
    // happened.
    const prompt = buildAgentPrompt(
      context({
        lastOutcome: {
          tool: "browser_click",
          status: "success",
          expectation: "the download starts",
          changed: "NOTHING CHANGED on the page — same URL, same controls, same values.",
        },
      })
    );
    expect(prompt).toContain("LAST ACTION: browser_click — SUCCESS");
    expect(prompt).toContain("You expected: the download starts");
    expect(prompt).toContain("WHAT CHANGED: NOTHING CHANGED");
  });

  it("surfaces notices, because a modal makes everything behind it unclickable", () => {
    const prompt = buildAgentPrompt(
      context({ page: { ...context().page, notices: ['Modal dialog open: "Session expired"'] } })
    );
    expect(prompt).toContain('! Modal dialog open: "Session expired"');
  });

  it("warns when the action budget is nearly spent", () => {
    expect(buildAgentPrompt(context({ actionsSoFar: 90, maxActions: 100 }))).toContain("running out of budget");
    expect(buildAgentPrompt(context({ actionsSoFar: 10, maxActions: 100 }))).not.toContain("running out of budget");
  });

  it("names the allowlist when one is configured", () => {
    expect(buildAgentPrompt(context({ allowedDomains: ["billing.test"] }))).toContain("Allowed domains: billing.test");
  });

  it("hides the agent's own bookkeeping variables from its own prompt", () => {
    const prompt = buildAgentPrompt(
      context({ variables: { orderId: "A-991", browserAgentLastError: "stale element" } })
    );
    expect(prompt).toContain("orderId = A-991");
    expect(prompt).not.toContain("browserAgentLastError = ");
  });

  it("forbids typing real secrets and gives the substitution token instead", () => {
    expect(buildAgentPrompt(context())).toContain("{{secret:name}}");
  });

  it("requires evidence before task_complete", () => {
    expect(buildAgentPrompt(context())).toMatch(/task_complete requires EVIDENCE/);
  });

  it("falls back to the legacy aria outline when no ref outline exists", () => {
    const prompt = buildAgentPrompt(
      context({ page: { ...context().page, outline: undefined, accessibilityTree: "- button: Download" } })
    );
    expect(prompt).toContain("- button: Download");
  });
});

describe("buildWorkflowGenerationPrompt", () => {
  it("offers the node types the executor actually supports", () => {
    const prompt = buildWorkflowGenerationPrompt("log in and download the invoice");
    expect(prompt).toContain("WAIT_FOR_TEXT");
    expect(prompt).toContain("SCROLL_TO_ELEMENT");
    expect(prompt).toContain("PROBE_PAGE");
  });

  it("steers drafts away from brittle selectors and hard-coded passwords", () => {
    const prompt = buildWorkflowGenerationPrompt("log in and download the invoice");
    expect(prompt).toContain("preferSemantic");
    expect(prompt).toContain("{{secret:site_password}}");
    expect(prompt).toContain("HUMAN_APPROVAL");
  });
});

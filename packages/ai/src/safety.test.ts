import { describe, expect, it } from "vitest";
import { AgentSafetyViolation, assertUrlAllowed, enforceAgentSafety } from "./safety";
import type { AgentAction, AgentContext } from "@bos/shared";

function context(partial: Partial<AgentContext> = {}): AgentContext {
  return {
    goal: "do the thing",
    page: { url: "https://app.test/", title: "App", visibleText: "" },
    variables: {},
    previousActions: [],
    actionsSoFar: 0,
    maxActions: 100,
    ...partial,
  };
}

function action(partial: Partial<AgentAction> & Pick<AgentAction, "tool">): AgentAction {
  return { reason: "because", ...partial } as AgentAction;
}

describe("enforceAgentSafety", () => {
  it("stops the agent at its action limit", () => {
    expect(() =>
      enforceAgentSafety(context({ actionsSoFar: 100, maxActions: 100 }), action({ tool: "browser_click", target: { ref: "e1" } }))
    ).toThrow(AgentSafetyViolation);
  });

  it("blocks navigation outside the allowlist", () => {
    expect(() =>
      enforceAgentSafety(
        context({ allowedDomains: ["app.test"] }),
        action({ tool: "browser_navigate", url: "https://elsewhere.test/steal" })
      )
    ).toThrow(/outside the allowlist/);
  });

  it("blocks a new tab outside the allowlist too", () => {
    // Opening the same URL in a new tab is the same escape; covering only
    // browser_navigate would leave a hole straight through the allowlist.
    expect(() =>
      enforceAgentSafety(
        context({ allowedDomains: ["app.test"] }),
        action({ tool: "browser_new_tab", url: "https://elsewhere.test/" })
      )
    ).toThrow(/outside the allowlist/);
  });

  it("allows subdomains of an allowed domain", () => {
    expect(() =>
      enforceAgentSafety(
        context({ allowedDomains: ["app.test"] }),
        action({ tool: "browser_navigate", url: "https://eu.app.test/orders" })
      )
    ).not.toThrow();
  });

  it("rejects an element action with no element, naming the fix", () => {
    expect(() => enforceAgentSafety(context(), action({ tool: "browser_click" }))).toThrow(/\{"ref":"e12"\}/);
  });

  it("rejects an empty target rather than letting the resolver time out on it", () => {
    expect(() => enforceAgentSafety(context(), action({ tool: "browser_click", target: {} }))).toThrow(
      /empty target/
    );
  });

  it("rejects tools that are missing the value they exist to carry", () => {
    expect(() => enforceAgentSafety(context(), action({ tool: "browser_type", target: { ref: "e1" } }))).toThrow(
      /needs a "value"/
    );
  });

  it("lets a well-formed action through", () => {
    expect(() =>
      enforceAgentSafety(
        context({ allowedDomains: ["app.test"] }),
        action({ tool: "browser_type", target: { ref: "e4" }, value: "hello" })
      )
    ).not.toThrow();
  });
});

describe("assertUrlAllowed", () => {
  it("catches the browser drifting off the allowlist without a navigation tool", () => {
    // A click on an outbound link never calls browser_navigate, so a pre-flight
    // check alone cannot keep the agent inside its allowlist.
    expect(() => assertUrlAllowed("https://tracker.test/x", ["app.test"])).toThrow(AgentSafetyViolation);
  });

  it("is a no-op when no allowlist is configured", () => {
    expect(() => assertUrlAllowed("https://anywhere.test/", undefined)).not.toThrow();
    expect(() => assertUrlAllowed("https://anywhere.test/", [])).not.toThrow();
  });

  it("ignores browser-internal pages", () => {
    expect(() => assertUrlAllowed("about:blank", ["app.test"])).not.toThrow();
  });
});

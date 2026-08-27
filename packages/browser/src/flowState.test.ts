import { describe, expect, it } from "vitest";
import { classifyFlowState, findComposer, findSubmit, toFlowStates } from "./flowState";
import type { PageProbeReport, ProbedElement } from "./pageProbe";

function element(partial: Partial<ProbedElement>): ProbedElement {
  return {
    index: 0,
    tag: "div",
    role: "generic",
    name: "",
    ariaLabel: null,
    placeholder: null,
    text: "",
    testId: null,
    href: null,
    type: null,
    visible: true,
    disabled: false,
    editable: false,
    inViewport: true,
    rect: { x: 0, y: 0, width: 100, height: 40 },
    cssPath: "body > div:nth-child(1)",
    attrs: {},
    ...partial,
  };
}

function report(partial: Partial<PageProbeReport>): PageProbeReport {
  return {
    url: "https://labs.google/fx/tools/flow",
    title: "Flow",
    readyState: "complete",
    visibleText: "",
    elements: [],
    hiddenInteractiveCount: 0,
    frames: [],
    media: { videos: 0, playableVideos: 0, progressBars: 0 },
    liveRegions: [],
    probedAt: new Date().toISOString(),
    ...partial,
  };
}

const composerElement = element({
  tag: "textarea",
  role: "textbox",
  name: "Generate a video with text",
  placeholder: "Generate a video with text",
  editable: true,
  rect: { x: 200, y: 700, width: 800, height: 90 },
  cssPath: "body > div:nth-child(2) > main > div > textarea",
  attrs: { placeholder: "Generate a video with text" },
});

describe("classifyFlowState", () => {
  it("reports LOGIN_REQUIRED for a Google account screen instead of hunting for a textbox", () => {
    const result = classifyFlowState(
      report({
        url: "https://accounts.google.com/v3/signin/identifier?continue=https://labs.google/fx/tools/flow",
        title: "Sign in - Google Accounts",
        visibleText: "Sign in to continue to Flow",
      })
    );
    expect(result.state).toBe("LOGIN_REQUIRED");
  });

  it("reports LOGIN_REQUIRED when sign-in is the only affordance on a Google-hosted page", () => {
    const result = classifyFlowState(
      report({
        visibleText: "Choose an account to continue",
        elements: [element({ role: "button", name: "Sign in", tag: "button" })],
      })
    );
    expect(result.state).toBe("LOGIN_REQUIRED");
  });

  it("reports LANDING and finds the entry control on the public marketing page", () => {
    const result = classifyFlowState(
      report({
        visibleText: "Flow. AI filmmaking. Create with Google Flow",
        elements: [
          element({ role: "link", tag: "a", name: "Create with Google Flow", cssPath: "body > header > a:nth-child(3)" }),
          element({ role: "button", tag: "button", name: "Sign in" }),
        ],
      })
    );
    expect(result.state).toBe("LANDING");
    expect(result.primaryAction?.cssPath).toBe("body > header > a:nth-child(3)");
  });

  it("prefers WORKSPACE over LANDING when a project-creation control exists", () => {
    const result = classifyFlowState(
      report({
        visibleText: "My projects. Get started",
        elements: [
          element({ role: "button", tag: "button", name: "Get started" }),
          element({ role: "button", tag: "button", name: "New project", cssPath: "body > main > button:nth-child(1)" }),
        ],
      })
    );
    expect(result.state).toBe("WORKSPACE");
    expect(result.primaryAction?.name).toBe("New project");
  });

  it("is not fooled into WORKSPACE by a 'Projects' nav link on the landing page", () => {
    const result = classifyFlowState(
      report({
        visibleText: "Flow\nProjects\nAI filmmaking",
        elements: [
          element({ role: "link", tag: "a", name: "Projects" }),
          element({ role: "link", tag: "a", name: "Create with Google Flow", cssPath: "#cta" }),
        ],
      })
    );
    expect(result.state).toBe("LANDING");
    expect(result.primaryAction?.cssPath).toBe("#cta");
  });

  it("reports GENERATION_UI and publishes the discovered composer selector", () => {
    const result = classifyFlowState(
      report({
        visibleText: "Generate a video with text",
        elements: [composerElement, element({ role: "button", tag: "button", name: "Generate", rect: { x: 1000, y: 720, width: 90, height: 40 } })],
      })
    );
    expect(result.state).toBe("GENERATION_UI");
    expect(result.composer?.cssPath).toBe("body > div:nth-child(2) > main > div > textarea");
    expect(result.submit?.name).toBe("Generate");
  });

  it("reports GENERATING while work is in flight, even with a composer on screen", () => {
    const result = classifyFlowState(
      report({
        visibleText: "Generating your video, this may take a few minutes",
        elements: [composerElement],
        media: { videos: 1, playableVideos: 0, progressBars: 1 },
      })
    );
    expect(result.state).toBe("GENERATING");
  });

  it("reports CLIP_READY once a playable result exists and nothing is generating", () => {
    const result = classifyFlowState(
      report({
        visibleText: "Download",
        elements: [composerElement],
        media: { videos: 1, playableVideos: 1, progressBars: 0 },
      })
    );
    expect(result.state).toBe("CLIP_READY");
  });

  it("reports ERROR when Flow surfaces a failure", () => {
    const result = classifyFlowState(
      report({
        visibleText: "Something went wrong. Please try again later.",
        elements: [composerElement],
      })
    );
    expect(result.state).toBe("ERROR");
    expect(result.errorText).toMatch(/something went wrong/i);
  });

  it("reports LOADING rather than UNKNOWN while the app shell is still coming up", () => {
    const result = classifyFlowState(report({ readyState: "loading" }));
    expect(result.state).toBe("LOADING");
  });

  it("reports UNKNOWN with diagnostics when nothing matches", () => {
    const result = classifyFlowState(
      report({
        visibleText: "An entirely redesigned screen",
        elements: [
          element({ role: "button", name: "Alpha" }),
          element({ role: "button", name: "Beta" }),
          element({ role: "button", name: "Gamma" }),
        ],
      })
    );
    expect(result.state).toBe("UNKNOWN");
    expect(result.reason).toMatch(/3 visible controls/);
  });
});

describe("composer and submit discovery", () => {
  it("does not mistake a header search box for the prompt composer", () => {
    const search = element({
      tag: "input",
      role: "searchbox",
      name: "Search projects",
      placeholder: "Search projects",
      editable: true,
      rect: { x: 400, y: 20, width: 300, height: 36 },
      cssPath: "body > header > input",
    });
    expect(findComposer(report({ elements: [search] }))).toBeUndefined();
    expect(findComposer(report({ elements: [search, composerElement] }))?.cssPath).toBe(composerElement.cssPath);
  });

  it("picks the submit control nearest the composer over a distant look-alike", () => {
    const near = element({ role: "button", tag: "button", name: "Generate", rect: { x: 1020, y: 720, width: 80, height: 40 }, cssPath: "near" });
    const far = element({ role: "button", tag: "button", name: "Generate", rect: { x: 20, y: 20, width: 80, height: 40 }, cssPath: "far" });
    expect(findSubmit(report({ elements: [far, near] }), composerElement)?.cssPath).toBe("near");
  });

  it("never returns a destructive control as the submit button", () => {
    const cancel = element({ role: "button", tag: "button", name: "Cancel", rect: { x: 1000, y: 720, width: 80, height: 40 } });
    expect(findSubmit(report({ elements: [cancel] }), composerElement)).toBeUndefined();
  });
});

describe("toFlowStates", () => {
  it("passes valid state names through", () => {
    expect(toFlowStates(["CLIP_READY", "ERROR"])) .toEqual(["CLIP_READY", "ERROR"]);
  });

  it("falls back when nothing was configured", () => {
    expect(toFlowStates(undefined, ["GENERATION_UI"])).toEqual(["GENERATION_UI"]);
    expect(toFlowStates([], ["GENERATION_UI"])).toEqual(["GENERATION_UI"]);
  });

  it("names a typo instead of silently never matching it", () => {
    expect(() => toFlowStates(["CLIP_RADY"])).toThrow(/Unknown Flow state\(s\) CLIP_RADY/);
  });
});

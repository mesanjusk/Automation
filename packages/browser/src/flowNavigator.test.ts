import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { waitForFlowState, navigateFlow } from "./flowNavigator";
import type { PageProbeReport } from "./pageProbe";
import type { BrowserSession } from "./session";

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

const COMPOSER = {
  index: 0,
  tag: "textarea",
  role: "textbox",
  name: "Generate a video with text",
  ariaLabel: null,
  placeholder: "Generate a video with text",
  text: "",
  testId: null,
  href: null,
  type: null,
  visible: true,
  disabled: false,
  editable: true,
  inViewport: true,
  rect: { x: 200, y: 700, width: 800, height: 90 },
  cssPath: "main > textarea",
  attrs: {},
};

/** A page whose successive probes return the given scripted reports. */
function scriptedPage(reports: PageProbeReport[]) {
  let index = 0;
  const click = vi.fn(async () => undefined);
  const page = {
    evaluate: async () => reports[Math.min(index++, reports.length - 1)],
    screenshot: async () => Buffer.from("png"),
    url: () => reports[Math.min(index, reports.length - 1)]?.url ?? "",
    locator: () => ({ first: () => ({ click }) }),
    waitForLoadState: async () => undefined,
  } as unknown as Page;
  return { page, click, consumed: () => index };
}

describe("waitForFlowState bounded polling", () => {
  it("returns as soon as the wanted state is observed", async () => {
    const { page } = scriptedPage([
      report({ visibleText: "Generating your video" }),
      report({ visibleText: "Download", elements: [COMPOSER], media: { videos: 1, playableVideos: 1, progressBars: 0 } }),
    ]);
    const observation = await waitForFlowState(page, {
      states: ["CLIP_READY"],
      timeoutMs: 5000,
      pollMs: 500,
    });
    expect(observation.classification.state).toBe("CLIP_READY");
  });

  it("fails fast and clearly when Flow shows a Google sign-in screen", async () => {
    const { page } = scriptedPage([report({ url: "https://accounts.google.com/v3/signin/identifier" })]);
    await expect(
      waitForFlowState(page, { states: ["GENERATION_UI"], timeoutMs: 5000, pollMs: 500 })
    ).rejects.toMatchObject({ errorCode: "GOOGLE_LOGIN_REQUIRED", category: "HUMAN_INTERVENTION_REQUIRED" });
  });

  it("fails fast on a listed failure state instead of waiting out the timeout", async () => {
    const { page } = scriptedPage([report({ visibleText: "Something went wrong", elements: [COMPOSER] })]);
    await expect(
      waitForFlowState(page, { states: ["CLIP_READY"], failStates: ["ERROR"], timeoutMs: 60_000, pollMs: 500 })
    ).rejects.toMatchObject({ errorCode: "FLOW_GENERATION_ERROR" });
  });

  it("times out with the states it saw and the controls it found", async () => {
    const { page } = scriptedPage([report({ visibleText: "Generating your video" })]);
    await expect(
      waitForFlowState(page, { states: ["CLIP_READY"], timeoutMs: 1000, pollMs: 500 })
    ).rejects.toMatchObject({ errorCode: "FLOW_STATE_TIMEOUT", retryable: true });
  });

  it("does not accept the previous clip's video as this clip's result", async () => {
    // The previous clip is still on screen the whole time and nothing new is
    // ever generated: the wait must time out rather than report success.
    const stale = report({
      visibleText: "Download",
      elements: [COMPOSER],
      media: { videos: 1, playableVideos: 1, progressBars: 0 },
    });
    const { page } = scriptedPage([stale]);
    await expect(
      waitForFlowState(page, { states: ["CLIP_READY"], timeoutMs: 1200, pollMs: 500, requireNewVideo: true })
    ).rejects.toMatchObject({ errorCode: "FLOW_STATE_TIMEOUT" });
  });

  it("accepts a clip that it watched generate and finish", async () => {
    const { page } = scriptedPage([
      report({ visibleText: "Download", elements: [COMPOSER], media: { videos: 1, playableVideos: 1, progressBars: 0 } }),
      report({ visibleText: "Generating your video", elements: [COMPOSER], media: { videos: 1, playableVideos: 1, progressBars: 1 } }),
      report({ visibleText: "Download", elements: [COMPOSER], media: { videos: 2, playableVideos: 2, progressBars: 0 } }),
    ]);
    const observation = await waitForFlowState(page, {
      states: ["CLIP_READY"],
      timeoutMs: 8000,
      pollMs: 500,
      requireNewVideo: true,
    });
    expect(observation.report.media.playableVideos).toBe(2);
  });

  it("captures a named screenshot on both the success and the failure path", async () => {
    const emitScreenshot = vi.fn();
    const { page } = scriptedPage([
      report({ visibleText: "Download", elements: [COMPOSER], media: { videos: 1, playableVideos: 1, progressBars: 0 } }),
    ]);
    await waitForFlowState(page, { states: ["CLIP_READY"], timeoutMs: 3000, screenshotName: "flow_clip_complete", emitScreenshot });
    expect(emitScreenshot).toHaveBeenCalledWith("flow_clip_complete", expect.any(Buffer), expect.objectContaining({ state: "CLIP_READY" }));

    const failing = scriptedPage([report({ url: "https://accounts.google.com/v3/signin/identifier" })]);
    const onError = vi.fn();
    await expect(
      waitForFlowState(failing.page, { states: ["GENERATION_UI"], timeoutMs: 1000, emitScreenshot: onError })
    ).rejects.toThrow();
    expect(onError).toHaveBeenCalledWith("flow_error", expect.any(Buffer), expect.anything());
  });
});

describe("navigateFlow state machine", () => {
  function sessionFor(page: Page): BrowserSession {
    return { activePage: page, tabs: [page], activeTabIndex: 0, switchTab: () => page } as unknown as BrowserSession;
  }

  it("clicks through the landing page to the generation UI", async () => {
    const landing = report({
      visibleText: "Create with Google Flow",
      elements: [
        {
          ...COMPOSER,
          tag: "a",
          role: "link",
          name: "Create with Google Flow",
          editable: false,
          placeholder: null,
          cssPath: "header > a:nth-child(2)",
        },
      ],
    });
    const app = report({ visibleText: "Generate a video with text", elements: [COMPOSER] });
    const { page, click } = scriptedPage([landing, app, app, app]);
    const emitScreenshot = vi.fn();

    const { observation } = await navigateFlow(sessionFor(page), { pollMs: 10, newTabGraceMs: 0, emitScreenshot });

    expect(observation.classification.state).toBe("GENERATION_UI");
    expect(click).toHaveBeenCalledTimes(1);
    const names = emitScreenshot.mock.calls.map((call) => call[0]);
    expect(names).toContain("flow_landing");
    expect(names).toContain("flow_after_create");
  });

  it("stops with GOOGLE_LOGIN_REQUIRED rather than a selector timeout", async () => {
    const { page } = scriptedPage([report({ url: "https://accounts.google.com/v3/signin/identifier" })]);
    await expect(navigateFlow(sessionFor(page), { pollMs: 10, newTabGraceMs: 0 })).rejects.toMatchObject({
      errorCode: "GOOGLE_LOGIN_REQUIRED",
    });
  });

  it("reports what it found when Flow shows an unrecognised screen", async () => {
    const { page } = scriptedPage([
      report({
        visibleText: "A completely new screen",
        elements: [
          { ...COMPOSER, role: "button", editable: false, name: "Alpha", placeholder: null },
          { ...COMPOSER, role: "button", editable: false, name: "Beta", placeholder: null },
          { ...COMPOSER, role: "button", editable: false, name: "Gamma", placeholder: null },
        ],
      }),
    ]);
    await expect(navigateFlow(sessionFor(page), { pollMs: 10, newTabGraceMs: 0 })).rejects.toMatchObject({
      errorCode: "FLOW_UNKNOWN_SCREEN",
      category: "WEBSITE_CHANGED",
    });
  });
});

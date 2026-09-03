import { describe, expect, it } from "vitest";
import { collectNotices, describeChanges, renderOutline, targetForElement } from "./agentSnapshot";
import type { PageProbeReport, ProbedElement } from "./pageProbe";

/** A probed control, with the boring fields filled in. */
function el(overrides: Partial<ProbedElement>): ProbedElement {
  return {
    ref: "e1",
    index: 0,
    frame: null,
    tag: "button",
    role: "button",
    name: "",
    ariaLabel: null,
    placeholder: null,
    text: "",
    value: null,
    testId: null,
    href: null,
    type: null,
    visible: true,
    disabled: false,
    editable: false,
    checked: null,
    expanded: null,
    inViewport: true,
    rect: { x: 0, y: 0, width: 40, height: 20 },
    cssPath: "div:nth-child(3) > div:nth-child(1) > button:nth-child(1)",
    attrs: {},
    ...overrides,
  };
}

function report(partial: Partial<PageProbeReport>): PageProbeReport {
  return {
    url: "https://example.test/",
    title: "Example",
    readyState: "complete",
    visibleText: "",
    elements: [],
    hiddenInteractiveCount: 0,
    frames: [],
    inaccessibleFrames: 0,
    media: { videos: 0, playableVideos: 0, progressBars: 0 },
    liveRegions: [],
    dialogs: [],
    scroll: { y: 0, height: 900, viewport: 900, atBottom: true },
    probedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("targetForElement", () => {
  it("leads with the ref, because that is the only exact handle", () => {
    const button = el({ ref: "e7", role: "button", name: "Continue" });
    expect(targetForElement(button, [button]).ref).toBe("e7");
  });

  it("still carries role and accessible name, so a re-render is survivable", () => {
    const button = el({ role: "button", name: "add Add Media" });
    const target = targetForElement(button, [button]);

    expect(target.role).toBe("button");
    expect(target.text).toBe("add Add Media");
    expect(target.preferSemantic).toBe(true);
    expect(target.css).toBe(button.cssPath);
  });

  it("never hands over a deep nth-child path as the only handle", () => {
    // The reported failure: a visible "Go Back" button that the resolver could
    // not find, because the only selector it was given was a positional path
    // that the app had already re-rendered out from under it.
    const button = el({ role: "button", name: "arrow_back Go Back" });
    const target = targetForElement(button, [button]);

    const durable = target.ref ?? target.role ?? target.text ?? target.ariaLabel ?? target.testId;
    expect(durable).toBeTruthy();
  });

  it("scopes to the frame the element was discovered in", () => {
    const inFrame = el({ ref: "e4", frame: "iframe:nth-child(2)", name: "Card number", editable: true });
    expect(targetForElement(inFrame, [inFrame]).frame).toBe("iframe:nth-child(2)");
  });

  it("indexes into the match set when identical controls repeat", () => {
    const first = el({ ref: "e1", role: "button", name: "more_vert More options", cssPath: "#a" });
    const second = el({ ref: "e2", role: "button", name: "more_vert More options", cssPath: "#b" });
    const third = el({ ref: "e3", role: "button", name: "more_vert More options", cssPath: "#c" });
    const rows = [first, second, third];

    expect(targetForElement(first, rows).nth).toBe(0);
    expect(targetForElement(third, rows).nth).toBe(2);
  });

  it("omits css when nth is in play, because indexing a unique path resolves to nothing", () => {
    const first = el({ ref: "e1", name: "Download", cssPath: "#one" });
    const second = el({ ref: "e2", name: "Download", cssPath: "#two" });

    const target = targetForElement(second, [first, second]);
    expect(target.nth).toBe(1);
    expect(target.css).toBeUndefined();
    expect(target.testId).toBeUndefined();
    // The ref is still exact even when the fallback hints are ambiguous.
    expect(target.ref).toBe("e2");
  });

  it("does not index when the twins are only similar, not identical", () => {
    const save = el({ name: "Save" });
    const saveAs = el({ ref: "e2", name: "Save as draft" });

    expect(targetForElement(save, [save, saveAs]).nth).toBeUndefined();
  });

  it("drops roles that match everything on the page", () => {
    const div = el({ tag: "div", role: "generic", name: "Untitled session" });
    const target = targetForElement(div, [div]);

    expect(target.role).toBeUndefined();
    expect(target.text).toBe("Untitled session");
    expect(target.css).toBe(div.cssPath);
  });

  it("carries the aria-label, test id and editability the probe found", () => {
    const box = el({ tag: "textarea", role: "textbox", name: "Editable text", ariaLabel: "Prompt", testId: "composer", editable: true });
    const target = targetForElement(box, [box]);

    expect(target.ariaLabel).toBe("Prompt");
    expect(target.testId).toBe("composer");
    expect(target.editable).toBe(true);
  });

  it("still produces a usable target for an anonymous control", () => {
    const anonymous = el({ tag: "div", role: "generic", name: "", text: "" });
    const target = targetForElement(anonymous, [anonymous]);

    expect(target.css).toBe(anonymous.cssPath);
    expect(target.nth).toBeUndefined();
  });
});

describe("renderOutline", () => {
  it("puts the ref first on every line so the agent can copy it", () => {
    const outline = renderOutline(
      report({ elements: [el({ ref: "e3", role: "button", name: "Sign in" })] })
    );
    expect(outline).toBe('[e3] button "Sign in"');
  });

  it("flags the states that change what an action will do", () => {
    const outline = renderOutline(
      report({
        elements: [
          el({ ref: "e1", role: "textbox", name: "Email", editable: true, value: "a@b.test" }),
          el({ ref: "e2", role: "button", name: "Submit", disabled: true }),
          el({ ref: "e3", role: "link", name: "Terms", inViewport: false, href: "/terms" }),
        ],
      })
    );
    expect(outline).toContain('[e1] textbox "Email" value="a@b.test" (editable)');
    expect(outline).toContain("(disabled)");
    expect(outline).toContain("(off-screen)");
    expect(outline).toContain("-> /terms");
  });

  it("says how many controls it had to leave out rather than silently truncating", () => {
    const elements = Array.from({ length: 5 }, (_, i) => el({ ref: `e${i + 1}`, name: `Item ${i}` }));
    expect(renderOutline(report({ elements }), 2)).toContain("3 more controls not listed");
  });

  it("is explicit when there is nothing to act on", () => {
    expect(renderOutline(report({}))).toBe("(no interactive controls are visible)");
  });
});

describe("collectNotices", () => {
  it("surfaces a modal before anything else, because it blocks the page", () => {
    const notices = collectNotices(report({ dialogs: ["Delete this project?"] }));
    expect(notices[0]).toContain("Modal dialog open");
  });

  it("admits when part of the page is unreadable rather than implying it is empty", () => {
    const notices = collectNotices(report({ inaccessibleFrames: 2 }));
    expect(notices.join(" ")).toContain("2 cross-origin iframe(s) could not be read");
  });

  it("reports content below the fold", () => {
    const notices = collectNotices(
      report({ scroll: { y: 0, height: 4000, viewport: 900, atBottom: false } })
    );
    expect(notices.join(" ")).toContain("More page below the fold");
  });
});

describe("describeChanges", () => {
  const before = report({
    elements: [el({ ref: "e1", name: "Search" }), el({ ref: "e2", name: "Submit", disabled: true })],
  });

  it("says plainly when an action had no effect at all", () => {
    // This is the message that stops an agent clicking a dead control forever.
    expect(describeChanges(before, before)).toContain("NOTHING CHANGED");
  });

  it("reports navigation", () => {
    const after = report({ url: "https://example.test/results", elements: before.elements });
    expect(describeChanges(before, after)).toContain("URL changed");
  });

  it("reports controls appearing and disappearing by identity, not by count", () => {
    const after = report({ elements: [el({ ref: "e1", name: "Search" }), el({ ref: "e9", name: "Result row" })] });
    const changes = describeChanges(before, after);
    expect(changes).toContain('1 new control(s): button "Result row"');
    expect(changes).toContain('1 control(s) gone: button "Submit"');
  });

  it("notices a control becoming enabled — the thing the agent was waiting for", () => {
    const after = report({
      elements: [el({ ref: "e1", name: "Search" }), el({ ref: "e2", name: "Submit", disabled: false })],
    });
    expect(describeChanges(before, after)).toContain("is now enabled");
  });

  it("notices a value landing in a field", () => {
    const after = report({
      elements: [el({ ref: "e1", name: "Search", value: "invoices" }), before.elements[1]!],
    });
    expect(describeChanges(before, after)).toContain('value is now "invoices"');
  });

  it("calls out a dialog opening", () => {
    const after = report({ elements: before.elements, dialogs: ["Are you sure?"] });
    expect(describeChanges(before, after)).toContain("Dialog opened");
  });

  it("does not pretend to know what changed on the first observation", () => {
    expect(describeChanges(undefined, before)).toBe("First observation of this page.");
  });
});

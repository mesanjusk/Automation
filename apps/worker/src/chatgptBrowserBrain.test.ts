import { describe, expect, it } from "vitest";
import type { ProbedElement } from "@bos/browser";
import { targetForElement } from "./chatgptBrowserBrain";

/** A probed control, with the boring fields filled in. */
function el(overrides: Partial<ProbedElement>): ProbedElement {
  return {
    index: 0,
    tag: "button",
    role: "button",
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
    rect: { x: 0, y: 0, width: 40, height: 20 },
    cssPath: "div:nth-child(3) > div:nth-child(1) > button:nth-child(1)",
    attrs: {},
    ...overrides,
  };
}

describe("targetForElement", () => {
  it("leads with role and accessible name, keeping the generated path as a fallback", () => {
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
    // that Flow had already re-rendered out from under it.
    const button = el({ role: "button", name: "arrow_back Go Back" });
    const target = targetForElement(button, [button]);

    const semantic = target.role ?? target.text ?? target.ariaLabel ?? target.testId;
    expect(semantic).toBeTruthy();
  });

  it("indexes into the match set when identical controls repeat", () => {
    const first = el({ role: "button", name: "more_vert More options", cssPath: "#a" });
    const second = el({ role: "button", name: "more_vert More options", cssPath: "#b" });
    const third = el({ role: "button", name: "more_vert More options", cssPath: "#c" });
    const rows = [first, second, third];

    expect(targetForElement(first, rows).nth).toBe(0);
    expect(targetForElement(third, rows).nth).toBe(2);
  });

  it("omits css when nth is in play, because indexing a unique path resolves to nothing", () => {
    const first = el({ name: "Download", cssPath: "#one" });
    const second = el({ name: "Download", cssPath: "#two" });

    const target = targetForElement(second, [first, second]);
    expect(target.nth).toBe(1);
    expect(target.css).toBeUndefined();
    expect(target.testId).toBeUndefined();
  });

  it("does not index when the twins are only similar, not identical", () => {
    const save = el({ name: "Save" });
    const saveAs = el({ name: "Save as draft" });

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

import type { Page } from "playwright";

/**
 * One interactive element as it actually exists on the live page.
 *
 * Everything here is *discovered*, never assumed: the role is the element's
 * explicit ARIA role or the implicit role of its tag, the name is computed the
 * way an assistive technology would compute it, and `cssPath` is a selector
 * generated from the element's real position in the real DOM. Nothing in this
 * file hard-codes a class name or a product-specific selector.
 */
export interface ProbedElement {
  /**
   * Stable handle stamped onto the DOM node itself (`data-bos-ref="e12"`).
   *
   * This is what makes an agent accurate rather than merely plausible: the
   * model is shown `e12` and can act on `e12`, so there is no lossy round trip
   * from "the element I saw" through a description and back to "an element
   * that matches that description". Refs survive re-renders that move an
   * element (the attribute travels with the node) and are reused across
   * probes of the same document, so `e12` means the same control every turn.
   */
  ref: string;
  index: number;
  /** CSS path of the owning iframe, or null when the element is in the main frame. */
  frame: string | null;
  tag: string;
  role: string;
  name: string;
  ariaLabel: string | null;
  placeholder: string | null;
  text: string;
  /** Current value of an input/textarea — lets the agent see what it already typed. */
  value: string | null;
  testId: string | null;
  href: string | null;
  type: string | null;
  visible: boolean;
  disabled: boolean;
  editable: boolean;
  checked: boolean | null;
  expanded: boolean | null;
  inViewport: boolean;
  rect: { x: number; y: number; width: number; height: number };
  cssPath: string;
  attrs: Record<string, string>;
}

export interface PageProbeReport {
  url: string;
  title: string;
  readyState: string;
  visibleText: string;
  elements: ProbedElement[];
  hiddenInteractiveCount: number;
  frames: string[];
  /** Frames whose contents could not be read (cross-origin) — the agent is told so it does not assume an empty page. */
  inaccessibleFrames: number;
  media: { videos: number; playableVideos: number; progressBars: number };
  liveRegions: string[];
  /** Open modal dialogs/alerts. A modal makes everything behind it unclickable, so it is called out separately. */
  dialogs: string[];
  scroll: { y: number; height: number; viewport: number; atBottom: boolean };
  probedAt: string;
}

export interface PageProbeOptions {
  maxElements?: number;
  maxTextLength?: number;
  /** Follow same-origin iframes. On by default — an agent that cannot see into a frame is blind to checkout forms, editors and embedded sign-ins. */
  includeFrames?: boolean;
}

/** Attribute used to stamp element refs. Public so the selector resolver can bind to it. */
export const REF_ATTRIBUTE = "data-bos-ref";

/**
 * Runs the probe inside the page and returns what is really on screen.
 *
 * tsx/esbuild can inject calls to a module-level `__name` helper into nested
 * functions. Playwright serialises the callback passed to page.evaluate but
 * not that helper, which caused `ReferenceError: __name is not defined` in
 * the browser utility script. Seed a compatible helper in the page realm via
 * a string expression before evaluating the probe callback.
 */
export async function probePage(page: Page, opts: PageProbeOptions = {}): Promise<PageProbeReport> {
  const maxElements = opts.maxElements ?? 120;
  const maxTextLength = opts.maxTextLength ?? 6000;
  const includeFrames = opts.includeFrames !== false;

  await page.evaluate(`globalThis.__name = globalThis.__name || ((target, value) => {
    try { Object.defineProperty(target, "name", { value, configurable: true }); } catch {}
    return target;
  })`);

  const report = await page.evaluate(
    ({ maxElements, maxTextLength, includeFrames, refAttr }: { maxElements: number; maxTextLength: number; includeFrames: boolean; refAttr: string }) => {
      const IMPLICIT_ROLES: Record<string, string> = {
        a: "link", button: "button", textarea: "textbox", select: "combobox",
        summary: "button", video: "video", img: "img", h1: "heading", h2: "heading",
        h3: "heading", form: "form", nav: "navigation", dialog: "dialog",
      };
      const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", "password", "number", ""]);
      const STABLE_ATTRS = ["data-testid","data-test-id","data-test","data-id","data-action","name","type","role","aria-label","aria-labelledby","aria-describedby","aria-disabled","aria-expanded","aria-haspopup","placeholder","contenteditable","title"];

      const clean = (value: string | null | undefined, cap: number): string =>
        (value ?? "").replace(/\s+/g, " ").trim().slice(0, cap);

      // Refs live on the node, so a re-render that moves an element keeps its
      // identity, and a control the agent saw last turn keeps the same handle.
      const store = globalThis as unknown as { __bosRefSeq?: number };
      const refFor = (el: Element): string => {
        const existing = el.getAttribute(refAttr);
        if (existing) return existing;
        store.__bosRefSeq = (store.__bosRefSeq ?? 0) + 1;
        const ref = `e${store.__bosRefSeq}`;
        try { el.setAttribute(refAttr, ref); } catch { /* frozen/readonly node — fall back to hints */ }
        return ref;
      };

      const isVisible = (el: Element, view: Window): boolean => {
        const style = view.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
        if (Number(style.opacity) < 0.05) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        if (rect.right + view.scrollX <= 0 || rect.bottom + view.scrollY <= 0) return false;
        return true;
      };

      const roleOf = (el: Element): string => {
        const explicit = el.getAttribute("role");
        if (explicit) return explicit.split(/\s+/)[0] ?? "";
        const tag = el.tagName.toLowerCase();
        if (tag === "input") {
          const type = (el as HTMLInputElement).type || "text";
          if (type === "checkbox") return "checkbox";
          if (type === "radio") return "radio";
          if (type === "submit" || type === "button" || type === "reset") return "button";
          if (type === "search") return "searchbox";
          return TEXT_INPUT_TYPES.has(type) ? "textbox" : type;
        }
        if ((el as HTMLElement).isContentEditable) return "textbox";
        if (tag === "a" && !el.getAttribute("href")) return "generic";
        return IMPLICIT_ROLES[tag] ?? "generic";
      };

      const accessibleName = (el: Element, doc: Document): string => {
        const label = el.getAttribute("aria-label");
        if (label && label.trim()) return clean(label, 160);
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const parts = labelledBy.split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? "").join(" ");
          if (parts.trim()) return clean(parts, 160);
        }
        const id = el.getAttribute("id");
        if (id) {
          const forLabel = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (forLabel?.textContent?.trim()) return clean(forLabel.textContent, 160);
        }
        const closestLabel = el.closest("label");
        if (closestLabel?.textContent?.trim()) return clean(closestLabel.textContent, 160);
        const placeholder = el.getAttribute("placeholder") || el.getAttribute("data-placeholder");
        if (placeholder && placeholder.trim()) return clean(placeholder, 160);
        const title = el.getAttribute("title");
        if (title && title.trim()) return clean(title, 160);
        const alt = el.getAttribute("alt");
        if (alt && alt.trim()) return clean(alt, 160);
        const own = clean((el as HTMLElement).innerText || el.textContent, 160);
        if (own) return own;
        return clean((el as HTMLInputElement).value, 160);
      };

      const isEditable = (el: Element): boolean => {
        if ((el as HTMLElement).isContentEditable) return true;
        const tag = el.tagName.toLowerCase();
        const disabled = (el as HTMLInputElement).disabled === true;
        const readOnly = (el as HTMLInputElement).readOnly === true;
        if (disabled || readOnly) return false;
        if (tag === "textarea") return true;
        if (tag === "input") return TEXT_INPUT_TYPES.has((el as HTMLInputElement).type || "text");
        return false;
      };

      const isDisabled = (el: Element): boolean =>
        (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";

      const triState = (el: Element, attr: string, prop: "checked"): boolean | null => {
        const aria = el.getAttribute(attr);
        if (aria === "true") return true;
        if (aria === "false") return false;
        const value = (el as unknown as Record<string, unknown>)[prop];
        return typeof value === "boolean" ? value : null;
      };

      const cssPathFor = (el: Element, doc: Document): string => {
        const id = el.getAttribute("id");
        if (id && /^[A-Za-z][\w-]*$/.test(id) && doc.querySelectorAll(`#${CSS.escape(id)}`).length === 1) return `#${CSS.escape(id)}`;
        for (const attr of ["data-testid", "data-test-id", "data-test"]) {
          const value = el.getAttribute(attr);
          if (value) {
            const selector = `[${attr}="${CSS.escape(value)}"]`;
            if (doc.querySelectorAll(selector).length === 1) return selector;
          }
        }
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node.nodeType === 1 && parts.length < 12) {
          const tag = node.tagName.toLowerCase();
          if (tag === "html" || tag === "body") { parts.unshift(tag); break; }
          const parent: Element | null = node.parentElement;
          if (!parent) { parts.unshift(tag); break; }
          const index = Array.prototype.indexOf.call(parent.children, node) + 1;
          parts.unshift(`${tag}:nth-child(${index})`);
          node = parent;
        }
        return parts.join(" > ");
      };

      const INTERACTIVE = ["a[href]","button","input","textarea","select","summary","video","[contenteditable='']","[contenteditable='true']","[role]","[aria-label]","[tabindex]:not([tabindex='-1'])"].join(",");

      const collected: ProbedElement[] = [];
      const framesSeen: string[] = [];
      let hiddenInteractiveCount = 0;
      let inaccessibleFrames = 0;

      const collect = (doc: Document, view: Window, framePath: string | null): void => {
        const all = Array.prototype.slice.call(doc.querySelectorAll(INTERACTIVE)) as Element[];
        const viewportHeight = view.innerHeight || 0;
        const viewportWidth = view.innerWidth || 0;
        for (const el of all) {
          if (collected.length >= maxElements) return;
          if (!isVisible(el, view)) { hiddenInteractiveCount += 1; continue; }
          const rect = el.getBoundingClientRect();
          const attrs: Record<string, string> = {};
          for (const attr of STABLE_ATTRS) {
            const value = el.getAttribute(attr);
            if (value !== null) attrs[attr] = clean(value, 120);
          }
          const expandedAttr = el.getAttribute("aria-expanded");
          collected.push({
            ref: refFor(el), index: collected.length, frame: framePath,
            tag: el.tagName.toLowerCase(), role: roleOf(el), name: accessibleName(el, doc),
            ariaLabel: el.getAttribute("aria-label"), placeholder: el.getAttribute("placeholder") || el.getAttribute("data-placeholder"),
            text: clean((el as HTMLElement).innerText || el.textContent, 200),
            value: clean((el as HTMLInputElement).value, 200) || null,
            testId: el.getAttribute("data-testid") || el.getAttribute("data-test-id"),
            href: el.getAttribute("href"), type: el.getAttribute("type"), visible: true,
            disabled: isDisabled(el), editable: isEditable(el),
            checked: triState(el, "aria-checked", "checked"),
            expanded: expandedAttr === "true" ? true : expandedAttr === "false" ? false : null,
            inViewport: rect.bottom > 0 && rect.top < viewportHeight && rect.right > 0 && rect.left < viewportWidth,
            rect: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
            cssPath: cssPathFor(el, doc), attrs,
          });
        }
      };

      collect(document, window, null);

      // Same-origin iframes are part of the page as far as a user is
      // concerned — payment forms, rich editors and embedded sign-ins all live
      // in one. Their elements carry the iframe's own CSS path so the resolver
      // can scope back into the right frame.
      if (includeFrames) {
        const iframes = Array.prototype.slice.call(document.querySelectorAll("iframe")) as HTMLIFrameElement[];
        for (const iframe of iframes.slice(0, 10)) {
          const src = iframe.src || "(about:blank)";
          framesSeen.push(src);
          if (collected.length >= maxElements) continue;
          let inner: Document | null = null;
          try { inner = iframe.contentDocument; } catch { inner = null; }
          if (!inner || !iframe.contentWindow) { inaccessibleFrames += 1; continue; }
          if (!isVisible(iframe, window)) continue;
          try {
            collect(inner, iframe.contentWindow, cssPathFor(iframe, document));
          } catch {
            inaccessibleFrames += 1;
          }
        }
      } else {
        for (const iframe of Array.prototype.slice.call(document.querySelectorAll("iframe")) as HTMLIFrameElement[]) {
          framesSeen.push(iframe.src || "(about:blank)");
        }
      }

      const videos = Array.prototype.slice.call(document.querySelectorAll("video")) as HTMLVideoElement[];
      const liveRegions = (Array.prototype.slice.call(document.querySelectorAll("[aria-live], [role='status'], [role='alert']")) as Element[])
        .map((el) => clean((el as HTMLElement).innerText || el.textContent, 200)).filter((text) => text.length > 0).slice(0, 10);
      const dialogs = (Array.prototype.slice.call(document.querySelectorAll("[role='dialog'], [role='alertdialog'], dialog[open]")) as Element[])
        .filter((el) => isVisible(el, window))
        .map((el) => clean(el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.textContent, 300))
        .filter((text) => text.length > 0).slice(0, 5);

      const scrollY = Math.round(window.scrollY);
      const docHeight = Math.round(document.documentElement?.scrollHeight ?? 0);
      const viewport = Math.round(window.innerHeight || 0);

      return {
        url: location.href, title: document.title, readyState: document.readyState,
        visibleText: clean(document.body?.innerText, maxTextLength), elements: collected, hiddenInteractiveCount,
        frames: framesSeen.slice(0, 10), inaccessibleFrames,
        media: { videos: videos.length, playableVideos: videos.filter((video) => (video.src || video.currentSrc || "").length > 0).length, progressBars: document.querySelectorAll("[role='progressbar'], progress").length },
        liveRegions, dialogs,
        scroll: { y: scrollY, height: docHeight, viewport, atBottom: docHeight - (scrollY + viewport) <= 4 },
        probedAt: new Date().toISOString(),
      };
    },
    { maxElements, maxTextLength, includeFrames, refAttr: REF_ATTRIBUTE }
  );

  return report as PageProbeReport;
}

export function summariseProbe(report: PageProbeReport, limit = 25): string {
  const rows = report.elements.slice(0, limit).map((el) => `- [${el.ref}] ${el.role} "${el.name || el.text}"${el.editable ? " [editable]" : ""}${el.disabled ? " [disabled]" : ""} => ${el.cssPath}`);
  return [`${report.url} — "${report.title}" (${report.elements.length} visible controls)`, ...rows].join("\n");
}

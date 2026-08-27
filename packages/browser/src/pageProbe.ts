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
  index: number;
  tag: string;
  role: string;
  name: string;
  ariaLabel: string | null;
  placeholder: string | null;
  text: string;
  testId: string | null;
  href: string | null;
  type: string | null;
  visible: boolean;
  disabled: boolean;
  editable: boolean;
  inViewport: boolean;
  rect: { x: number; y: number; width: number; height: number };
  /** Selector discovered from the live DOM; usable directly by Playwright. */
  cssPath: string;
  attrs: Record<string, string>;
}

export interface PageProbeReport {
  url: string;
  title: string;
  readyState: string;
  /** Trimmed innerText — the visible-text signal the classifier reasons over. */
  visibleText: string;
  elements: ProbedElement[];
  hiddenInteractiveCount: number;
  frames: string[];
  media: { videos: number; playableVideos: number; progressBars: number };
  liveRegions: string[];
  probedAt: string;
}

export interface PageProbeOptions {
  /** Cap on elements returned so execution-step documents stay small. */
  maxElements?: number;
  maxTextLength?: number;
}

/**
 * Runs the probe inside the page and returns what is really on screen.
 *
 * The whole probe is one self-contained function because `page.evaluate`
 * serialises it — it cannot reference anything from this module's scope.
 */
export async function probePage(page: Page, opts: PageProbeOptions = {}): Promise<PageProbeReport> {
  const maxElements = opts.maxElements ?? 120;
  const maxTextLength = opts.maxTextLength ?? 6000;

  const report = await page.evaluate(
    ({ maxElements, maxTextLength }: { maxElements: number; maxTextLength: number }) => {
      const IMPLICIT_ROLES: Record<string, string> = {
        a: "link",
        button: "button",
        textarea: "textbox",
        select: "combobox",
        summary: "button",
        video: "video",
        img: "img",
        h1: "heading",
        h2: "heading",
        h3: "heading",
        form: "form",
        nav: "navigation",
        dialog: "dialog",
      };
      const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", "password", "number", ""]);
      const STABLE_ATTRS = [
        "data-testid",
        "data-test-id",
        "data-test",
        "data-id",
        "data-action",
        "name",
        "type",
        "role",
        "aria-label",
        "aria-labelledby",
        "aria-describedby",
        "aria-disabled",
        "aria-expanded",
        "aria-haspopup",
        "placeholder",
        "contenteditable",
        "title",
      ];

      const clean = (value: string | null | undefined, cap: number): string =>
        (value ?? "").replace(/\s+/g, " ").trim().slice(0, cap);

      const isVisible = (el: Element): boolean => {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
        if (Number(style.opacity) < 0.05) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        // The classic "screen-reader only" trick — position it at left:-9999px —
        // leaves a real bounding box, so size alone does not catch it. Compare
        // against the *document* origin rather than the viewport so an element
        // merely scrolled out of view is still counted as visible.
        if (rect.right + window.scrollX <= 0 || rect.bottom + window.scrollY <= 0) return false;
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

      const accessibleName = (el: Element): string => {
        const label = el.getAttribute("aria-label");
        if (label && label.trim()) return clean(label, 160);
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const parts = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ");
          if (parts.trim()) return clean(parts, 160);
        }
        const id = el.getAttribute("id");
        if (id) {
          const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
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

      const cssPathFor = (el: Element): string => {
        const id = el.getAttribute("id");
        if (id && /^[A-Za-z][\w-]*$/.test(id) && document.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
          return `#${CSS.escape(id)}`;
        }
        for (const attr of ["data-testid", "data-test-id", "data-test"]) {
          const value = el.getAttribute(attr);
          if (value) {
            const selector = `[${attr}="${CSS.escape(value)}"]`;
            if (document.querySelectorAll(selector).length === 1) return selector;
          }
        }
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node.nodeType === 1 && parts.length < 12) {
          const tag = node.tagName.toLowerCase();
          if (tag === "html" || tag === "body") {
            parts.unshift(tag);
            break;
          }
          const parent: Element | null = node.parentElement;
          if (!parent) {
            parts.unshift(tag);
            break;
          }
          const index = Array.prototype.indexOf.call(parent.children, node) + 1;
          parts.unshift(`${tag}:nth-child(${index})`);
          node = parent;
        }
        return parts.join(" > ");
      };

      const selector = [
        "a[href]",
        "button",
        "input",
        "textarea",
        "select",
        "summary",
        "video",
        "[contenteditable='']",
        "[contenteditable='true']",
        "[role]",
        "[aria-label]",
        "[tabindex]:not([tabindex='-1'])",
      ].join(",");

      const all = Array.prototype.slice.call(document.querySelectorAll(selector)) as Element[];
      const viewportHeight = window.innerHeight || 0;
      const viewportWidth = window.innerWidth || 0;

      // Type-only reference to the module-level interface: erased at compile
      // time, so nothing from this module's scope leaks into the page.
      const visible: ProbedElement[] = [];
      let hiddenInteractiveCount = 0;

      for (const el of all) {
        if (!isVisible(el)) {
          hiddenInteractiveCount += 1;
          continue;
        }
        const rect = el.getBoundingClientRect();
        const attrs: Record<string, string> = {};
        for (const attr of STABLE_ATTRS) {
          const value = el.getAttribute(attr);
          if (value !== null) attrs[attr] = clean(value, 120);
        }
        visible.push({
          index: visible.length,
          tag: el.tagName.toLowerCase(),
          role: roleOf(el),
          name: accessibleName(el),
          ariaLabel: el.getAttribute("aria-label"),
          placeholder: el.getAttribute("placeholder") || el.getAttribute("data-placeholder"),
          text: clean((el as HTMLElement).innerText || el.textContent, 200),
          testId: el.getAttribute("data-testid") || el.getAttribute("data-test-id"),
          href: el.getAttribute("href"),
          type: el.getAttribute("type"),
          visible: true,
          disabled: isDisabled(el),
          editable: isEditable(el),
          inViewport: rect.bottom > 0 && rect.top < viewportHeight && rect.right > 0 && rect.left < viewportWidth,
          rect: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          cssPath: cssPathFor(el),
          attrs,
        });
        if (visible.length >= maxElements) break;
      }

      const videos = Array.prototype.slice.call(document.querySelectorAll("video")) as HTMLVideoElement[];
      const liveRegions = (Array.prototype.slice.call(
        document.querySelectorAll("[aria-live], [role='status'], [role='alert']")
      ) as Element[])
        .map((el) => clean((el as HTMLElement).innerText || el.textContent, 200))
        .filter((text) => text.length > 0)
        .slice(0, 10);

      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        visibleText: clean(document.body?.innerText, maxTextLength),
        elements: visible,
        hiddenInteractiveCount,
        frames: (Array.prototype.slice.call(document.querySelectorAll("iframe")) as HTMLIFrameElement[])
          .map((frame) => frame.src || "(about:blank)")
          .slice(0, 10),
        media: {
          videos: videos.length,
          playableVideos: videos.filter((video) => (video.src || video.currentSrc || "").length > 0).length,
          progressBars: document.querySelectorAll("[role='progressbar'], progress").length,
        },
        liveRegions,
        probedAt: new Date().toISOString(),
      };
    },
    { maxElements, maxTextLength }
  );

  return report as PageProbeReport;
}

/** Compact, log-friendly rendering of what the probe found. */
export function summariseProbe(report: PageProbeReport, limit = 25): string {
  const rows = report.elements
    .slice(0, limit)
    .map((el) => `- ${el.role} "${el.name || el.text}"${el.editable ? " [editable]" : ""}${el.disabled ? " [disabled]" : ""} => ${el.cssPath}`);
  return [`${report.url} — "${report.title}" (${report.elements.length} visible controls)`, ...rows].join("\n");
}

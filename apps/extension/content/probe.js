// content/probe.js
// Scans the active webpage, stamps data-agent-ref attributes,
// creates visual badges, and returns a structured outline for the AI.

(() => {
  const REF_ATTR = "data-agent-ref";
  const BADGE_CONTAINER_ID = "webcopilot-badges-container";

  function cleanText(str, maxLen = 80) {
    if (!str) return "";
    return str.replace(/\s+/g, " ").trim().slice(0, maxLen);
  }

  function isElementVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) return false;

    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      style.pointerEvents === "none"
    ) {
      return false;
    }

    return true;
  }

  function getElementLabel(el) {
    // Priority: aria-label -> placeholder -> text content -> title -> alt -> value
    const aria = el.getAttribute("aria-label");
    if (aria) return cleanText(aria);

    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return cleanText(placeholder);

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const name = el.getAttribute("name");
      if (name) return cleanText(name);
    }

    const title = el.getAttribute("title");
    if (title) return cleanText(title);

    const alt = el.getAttribute("alt");
    if (alt) return cleanText(alt);

    const text = cleanText(el.innerText || el.textContent);
    if (text) return text;

    return "";
  }

  function probe(options = {}) {
    const showBadges = options.showBadges !== false;
    const maxElements = options.maxElements || 100;

    // 1. Clear old badge container if exists
    let badgeContainer = document.getElementById(BADGE_CONTAINER_ID);
    if (badgeContainer) {
      badgeContainer.remove();
    }

    if (showBadges) {
      badgeContainer = document.createElement("div");
      badgeContainer.id = BADGE_CONTAINER_ID;
      badgeContainer.style.position = "absolute";
      badgeContainer.style.top = "0";
      badgeContainer.style.left = "0";
      badgeContainer.style.width = "100%";
      badgeContainer.style.height = "100%";
      badgeContainer.style.pointerEvents = "none";
      badgeContainer.style.zIndex = "2147483640";
      document.body.appendChild(badgeContainer);
    }

    // 2. Select interactive candidates
    const selector = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "summary",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='combobox']",
      "[role='tab']",
      "[role='menuitem']",
      "[contenteditable='true']",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");

    const rawElements = Array.from(document.querySelectorAll(selector));
    const elements = [];
    let counter = 1;

    // Viewport bounds
    const vpWidth = window.innerWidth;
    const vpHeight = window.innerHeight;

    for (const el of rawElements) {
      if (!isElementVisible(el)) continue;

      // Skip elements inside our own badge container
      if (el.closest(`#${BADGE_CONTAINER_ID}`)) continue;

      const rect = el.getBoundingClientRect();
      const inViewport = (
        rect.top < vpHeight &&
        rect.bottom > 0 &&
        rect.left < vpWidth &&
        rect.right > 0
      );

      // Re-use existing ref or create new
      let ref = el.getAttribute(REF_ATTR);
      if (!ref) {
        ref = `e${counter}`;
        try {
          el.setAttribute(REF_ATTR, ref);
        } catch (e) {}
      }
      counter++;

      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || "").toLowerCase();
      const role = el.getAttribute("role") || (tag === "a" ? "link" : tag === "button" ? "button" : (tag === "input" ? "input" : tag));
      const label = getElementLabel(el);
      const isEditable = (
        tag === "textarea" ||
        (tag === "input" && !["button", "submit", "reset", "checkbox", "radio", "file"].includes(type)) ||
        el.isContentEditable ||
        el.getAttribute("contenteditable") !== null ||
        role === "textbox"
      );
      const currentValue = isEditable ? (el.value !== undefined && el.value !== "" ? el.value : el.innerText || "") : null;
      const isDisabled = el.disabled || el.getAttribute("aria-disabled") === "true";

      elements.push({
        ref,
        tag,
        role,
        label,
        type: type || undefined,
        editable: isEditable,
        disabled: isDisabled,
        value: currentValue ? cleanText(currentValue, 40) : null,
        inViewport,
        rect: {
          x: Math.round(rect.left + window.scrollX),
          y: Math.round(rect.top + window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      });

      // Render badge if enabled
      if (showBadges && badgeContainer && inViewport) {
        const badge = document.createElement("div");
        badge.className = "webcopilot-badge";
        badge.textContent = ref;
        badge.style.left = `${rect.left + window.scrollX}px`;
        badge.style.top = `${rect.top + window.scrollY}px`;
        badgeContainer.appendChild(badge);
      }

      if (elements.length >= maxElements) break;
    }

    // 3. Build plain text outline for prompt
    const outlineLines = elements.map(el => {
      let desc = `[${el.ref}] ${el.role || el.tag}`;
      if (el.label) desc += ` "${el.label}"`;
      if (el.editable) desc += ` [editable]`;
      if (el.value) desc += ` (current value: "${el.value}")`;
      if (el.disabled) desc += ` (disabled)`;
      if (!el.inViewport) desc += ` (off-screen)`;
      return desc;
    });

    const scrollY = window.scrollY;
    const docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    const atBottom = (scrollY + vpHeight) >= (docHeight - 20);

    return {
      title: document.title,
      url: window.location.href,
      scroll: {
        y: Math.round(scrollY),
        height: Math.round(docHeight),
        viewport: vpHeight,
        atBottom
      },
      elementCount: elements.length,
      outline: outlineLines.join("\n"),
      elements
    };
  }

  // Expose on global window for execution
  window.__webcopilot_probe = probe;
  return probe();
})();

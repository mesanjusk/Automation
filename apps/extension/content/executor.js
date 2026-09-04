// content/executor.js
// Executes simulated actions directly on the active webpage.

(() => {
  const BADGE_CONTAINER_ID = "webcopilot-badges-container";

  function findElementByRef(ref) {
    if (!ref) return null;
    return document.querySelector(`[data-agent-ref="${ref}"]`);
  }

  function flashHighlight(el, className, duration = 600) {
    if (!el) return;
    el.classList.add(className);
    el.classList.add("webcopilot-pulse");
    setTimeout(() => {
      el.classList.remove(className);
      el.classList.remove("webcopilot-pulse");
    }, duration);
  }

  function findTargetInput(targetEl) {
    if (!targetEl) return null;
    if (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA" || targetEl.isContentEditable) {
      return targetEl;
    }
    const inner = targetEl.querySelector("input, textarea, [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only'], [role='textbox']");
    if (inner) return inner;
    return targetEl;
  }

  function setElementValue(targetEl, value) {
    const el = findTargetInput(targetEl);
    el.focus();

    const tag = el.tagName.toLowerCase();
    const isInputOrTextarea = tag === "input" || tag === "textarea";
    const isContentEditable = el.isContentEditable || el.getAttribute("contenteditable") !== null || el.getAttribute("role") === "textbox";

    if (isContentEditable && !isInputOrTextarea) {
      el.focus();

      // Select existing content
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);

      let success = false;
      try {
        success = document.execCommand("insertText", false, value);
      } catch (e) {
        success = false;
      }

      if (!success || el.innerText.trim() !== value.trim()) {
        el.dispatchEvent(new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: value
        }));
        el.innerText = value;
        el.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: value
        }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    const proto = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event("beforeinput", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  }

  async function executeAction(actionRequest) {
    const { action, ref, value, key } = actionRequest;

    if (action === "clearBadges") {
      const container = document.getElementById(BADGE_CONTAINER_ID);
      if (container) container.remove();
      return { success: true, detail: "Cleared badges" };
    }

    if (action === "scroll") {
      const direction = (value || "down").toLowerCase();
      const amount = window.innerHeight * 0.75;

      if (direction === "down") {
        window.scrollBy({ top: amount, behavior: "smooth" });
      } else if (direction === "up") {
        window.scrollBy({ top: -amount, behavior: "smooth" });
      } else if (direction === "top") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (direction === "bottom") {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      }
      return { success: true, detail: `Scrolled ${direction}` };
    }

    if (action === "press") {
      const activeEl = (ref ? findElementByRef(ref) : document.activeElement) || document.body;
      const keyName = key || value || "Enter";

      const eventInit = {
        key: keyName,
        code: keyName === "Enter" ? "Enter" : keyName,
        keyCode: keyName === "Enter" ? 13 : 0,
        which: keyName === "Enter" ? 13 : 0,
        bubbles: true,
        cancelable: true
      };

      activeEl.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      activeEl.dispatchEvent(new KeyboardEvent("keypress", eventInit));
      activeEl.dispatchEvent(new KeyboardEvent("keyup", eventInit));

      // If pressing Enter in a form/input, optionally submit the form
      if (keyName === "Enter" && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
        const form = activeEl.closest("form");
        if (form) {
          const submitBtn = form.querySelector("button[type='submit'], input[type='submit']");
          if (submitBtn) {
            submitBtn.click();
          } else {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          }
        }
      }

      return { success: true, detail: `Pressed key: ${keyName}` };
    }

    // For element-targeted actions (click, type, hover)
    const el = findElementByRef(ref);
    if (!el) {
      return {
        success: false,
        error: `Element [${ref}] was not found in the current DOM. It may have moved or disappeared.`
      };
    }

    // Bring element into viewport
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    if (action === "click") {
      flashHighlight(el, "webcopilot-highlight-click");
      el.focus();

      // Dispatch realistic mouse sequence
      const mouseOpts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new PointerEvent("pointerdown", mouseOpts));
      el.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
      el.dispatchEvent(new PointerEvent("pointerup", mouseOpts));
      el.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
      el.click();

      return {
        success: true,
        detail: `Clicked [${ref}] <${el.tagName.toLowerCase()}> "${(el.innerText || el.value || "").slice(0, 30)}"`
      };
    }

    if (action === "type") {
      const activeInput = findTargetInput(el);
      flashHighlight(activeInput || el, "webcopilot-highlight-type");
      setElementValue(el, value ?? "");
      const preview = (value || "").slice(0, 45);
      return {
        success: true,
        detail: `Typed "${preview}${value && value.length > 45 ? "..." : ""}" into [${ref}]`
      };
    }

    if (action === "hover") {
      const mouseOpts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new MouseEvent("mouseover", mouseOpts));
      el.dispatchEvent(new MouseEvent("mouseenter", mouseOpts));
      return { success: true, detail: `Hovered over [${ref}]` };
    }

    return { success: false, error: `Unknown action: ${action}` };
  }

  // Expose on global window
  window.__webcopilot_execute = executeAction;
  return executeAction;
})();

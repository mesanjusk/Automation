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

    // 1. If targetEl itself is directly an input or textarea
    if (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA") {
      return targetEl;
    }

    // 2. If targetEl itself is contenteditable
    if (targetEl.isContentEditable || targetEl.getAttribute("contenteditable") === "true") {
      return targetEl;
    }

    // 3. Search inside targetEl for real editable element
    const inner = targetEl.querySelector("textarea, input:not([type='hidden']), [contenteditable='true']");
    if (inner) return inner;

    // 4. Search in siblings and parent
    const parent = targetEl.parentElement;
    if (parent) {
      const sibling = parent.querySelector("textarea, input:not([type='hidden']), [contenteditable='true']");
      if (sibling && sibling !== targetEl) return sibling;
    }

    // 5. Search closest composer or form
    const composer = (targetEl.closest && targetEl.closest("[class*='prompt'], [class*='composer'], [class*='input'], [class*='search'], form, main")) || parent?.parentElement;
    if (composer) {
      const compInput = composer.querySelector("textarea, input:not([type='hidden']), [contenteditable='true']");
      if (compInput && compInput !== targetEl) return compInput;
    }

    return targetEl;
  }

  function setElementValue(targetEl, value) {
    if (!targetEl) return;

    // 1. Bring element into view
    try {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {}

    // 2. Find center coordinates and simulate realistic pointer/mouse click
    const rect = targetEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const centerEl = (centerX > 0 && centerY > 0) ? document.elementFromPoint(centerX, centerY) : targetEl;
    const clickTarget = centerEl || targetEl;

    try {
      const clickOpts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: centerX,
        clientY: centerY
      };
      clickTarget.dispatchEvent(new PointerEvent("pointerdown", { ...clickOpts, pointerType: "mouse", isPrimary: true }));
      clickTarget.dispatchEvent(new MouseEvent("mousedown", clickOpts));
      clickTarget.dispatchEvent(new PointerEvent("pointerup", { ...clickOpts, pointerType: "mouse", isPrimary: true }));
      clickTarget.dispatchEvent(new MouseEvent("mouseup", clickOpts));
      clickTarget.dispatchEvent(new MouseEvent("click", clickOpts));
      clickTarget.focus();
    } catch (e) {}

    // 3. Resolve active input (if clicking activated a real input or shadow DOM element)
    let el = findTargetInput(targetEl);
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    if (active && active !== document.body && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.isContentEditable)) {
      el = active;
    }

    const tag = el.tagName.toLowerCase();
    const isInputOrTextarea = tag === "input" || tag === "textarea";
    const isContentEditable = el.isContentEditable || el.getAttribute("contenteditable") === "true" || el.getAttribute("role") === "textbox";

    if (isInputOrTextarea) {
      // 1. Select all & try native execCommand insertText
      try {
        el.focus();
        el.select();
        document.execCommand("selectAll", false, null);
        document.execCommand("delete", false, null);
        document.execCommand("insertText", false, value);
      } catch (e) {}

      // 2. Prototype setter to bypass React/Angular/Wiz value trackers
      const proto = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) {
        setter.call(el, value);
      } else {
        el.value = value;
      }

      // 3. Dispatch standard input events
      el.dispatchEvent(new Event("beforeinput", { bubbles: true, cancelable: true, composed: true }));
      el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true, composed: true }));
      el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true, composed: true }));
    } else {
      // Rich text editors (Lexical, ProseMirror, Slate, Draft.js, Google Flow)
      try {
        el.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) {}

      // Strategy A: Native execCommand delete then insertText
      let execSuccess = false;
      try {
        document.execCommand("delete", false, null);
        execSuccess = document.execCommand("insertText", false, value);
      } catch (e) {
        execSuccess = false;
      }

      // Strategy B: Synthetic Clipboard paste event (DataTransfer)
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", value);
        const pasteEvt = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clipboardData: dt
        });
        el.dispatchEvent(pasteEvt);
      } catch (e) {}

      // Strategy C: Dispatch InputEvent
      const inputInit = { bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: value };
      el.dispatchEvent(new InputEvent("beforeinput", inputInit));

      // Strategy D: Ensure text node exists inside paragraph if editor structure permits
      if (!el.textContent || !el.textContent.includes(value.slice(0, 10))) {
        const p = el.querySelector("p, span") || el;
        p.textContent = value;
      }

      el.dispatchEvent(new InputEvent("input", inputInit));
      el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }

    // Direct React props invocation if component uses React state
    for (const k of Object.keys(el)) {
      if (k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers")) {
        try {
          const p = el[k];
          if (p && typeof p.onChange === "function") p.onChange({ target: { value } });
          if (p && typeof p.onInput === "function") p.onInput({ target: { value } });
        } catch (e) {}
      }
    }

    // Key events (Space) to notify reactive watchers in Angular/Wiz
    const keyInit = { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new KeyboardEvent("keydown", keyInit));
    el.dispatchEvent(new KeyboardEvent("keyup", keyInit));

    // Re-enable any submit button in the composer
    const composer = (el.closest && el.closest("[class*='prompt'], [class*='composer'], [class*='input'], [class*='bar'], form")) || el.parentElement?.parentElement;
    if (composer) {
      setTimeout(() => {
        composer.querySelectorAll("button, [role='button']").forEach(btn => {
          btn.disabled = false;
          btn.removeAttribute("disabled");
          btn.removeAttribute("aria-disabled");
          btn.classList.remove("disabled");
        });
      }, 80);
    }
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
      let activeEl = ref ? findElementByRef(ref) : document.activeElement;
      if (!activeEl || activeEl === document.body) {
        activeEl = document.querySelector("textarea:focus, input:focus, [contenteditable='true']:focus")
          || document.querySelector("textarea, [contenteditable='true'], [role='textbox']")
          || document.body;
      }
      if (activeEl) {
        try { activeEl.focus(); } catch (e) {}
      }

      const keyName = key || value || "Enter";
      const eventInit = {
        key: keyName,
        code: keyName === "Enter" ? "Enter" : keyName,
        keyCode: keyName === "Enter" ? 13 : 0,
        which: keyName === "Enter" ? 13 : 0,
        charCode: keyName === "Enter" ? 13 : 0,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      };

      activeEl.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      activeEl.dispatchEvent(new KeyboardEvent("keypress", eventInit));
      activeEl.dispatchEvent(new KeyboardEvent("keyup", eventInit));

      // If pressing Enter in a form, input, or prompt composer:
      if (keyName === "Enter") {
        const composer = (activeEl.closest && activeEl.closest("[class*='prompt'], [class*='composer'], [class*='input'], [class*='bar'], form"))
          || activeEl.parentElement?.parentElement
          || document.querySelector("[class*='prompt'], [class*='composer']");

        if (composer) {
          const sendBtn = composer.querySelector("button[type='submit'], button[aria-label*='Send'], button[aria-label*='Create'], button[aria-label*='generate'], button:has(svg), button");
          if (sendBtn && sendBtn !== activeEl) {
            sendBtn.disabled = false;
            sendBtn.removeAttribute("disabled");
            sendBtn.removeAttribute("aria-disabled");
            sendBtn.classList.remove("disabled");
            sendBtn.click();
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

      // If button has disabled attribute or aria-disabled, un-disable it before clicking
      if (el.disabled || el.getAttribute("aria-disabled") === "true") {
        el.disabled = false;
        el.removeAttribute("disabled");
        el.removeAttribute("aria-disabled");
        el.classList.remove("disabled");
      }

      // Dispatch realistic mouse & pointer sequence to both el and child icon/svg
      const targets = [el];
      const child = el.querySelector("svg, i, span, img, path");
      if (child) targets.push(child);

      const mouseOpts = { bubbles: true, cancelable: true, view: window, composed: true };
      const pointerOpts = { bubbles: true, cancelable: true, view: window, composed: true, pointerType: "mouse", isPrimary: true };

      for (const t of targets) {
        t.dispatchEvent(new PointerEvent("pointerdown", pointerOpts));
        t.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
        t.dispatchEvent(new PointerEvent("pointerup", pointerOpts));
        t.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
        t.dispatchEvent(new MouseEvent("click", mouseOpts));
      }
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

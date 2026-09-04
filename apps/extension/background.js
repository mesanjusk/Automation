// Background service worker for WebCopilot AI
// Configures side panel and handles trusted CDP hardware actions

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error("Failed to set side panel behavior:", error));
  }
});

const attachedTabs = new Set();

async function attachCdp(tabId) {
  if (attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedTabs.add(tabId);
  } catch (err) {
    if (err.message && err.message.includes("Already attached")) {
      attachedTabs.add(tabId);
    } else {
      throw err;
    }
  }
}

async function detachCdp(tabId) {
  if (!attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) {}
  attachedTabs.delete(tabId);
}

if (chrome.debugger && chrome.debugger.onDetach) {
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) attachedTabs.delete(source.tabId);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ status: "PONG" });
    return false;
  }

  if (message.type === "CDP_DETACH") {
    if (message.tabId) {
      detachCdp(message.tabId).then(() => sendResponse({ success: true }));
      return true;
    }
  }

  if (message.type === "CDP_ACTION") {
    handleCdpAction(message).then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  return false;
});

async function handleCdpAction(message) {
  const { action, tabId, x, y, text, key } = message;

  try {
    await attachCdp(tabId);

    if (action === "click") {
      if (typeof x === "number" && typeof y === "number") {
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: Math.round(x),
          y: Math.round(y),
          button: "left",
          clickCount: 1
        });
        await new Promise(r => setTimeout(r, 60));
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: Math.round(x),
          y: Math.round(y),
          button: "left",
          clickCount: 1
        });
        return { success: true, detail: `Trusted click at (${Math.round(x)}, ${Math.round(y)})` };
      }
    }

    if (action === "type") {
      // 1. Click target first to establish focus and activate editor
      if (typeof x === "number" && typeof y === "number") {
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: Math.round(x),
          y: Math.round(y),
          button: "left",
          clickCount: 1
        });
        await new Promise(r => setTimeout(r, 60));
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: Math.round(x),
          y: Math.round(y),
          button: "left",
          clickCount: 1
        });
        await new Promise(r => setTimeout(r, 120));
      }

      // 2. Select all existing text and delete it
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
        type: "keyDown",
        modifiers: 2, // Ctrl
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
        type: "keyUp",
        modifiers: 0,
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65
      });
      await new Promise(r => setTimeout(r, 40));

      // 3. Insert text natively via browser IME / CDP pipeline
      await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text: text ?? "" });
      await new Promise(r => setTimeout(r, 80));

      return { success: true, detail: `Trusted hardware typed "${(text || "").slice(0, 45)}..."` };
    }

    if (action === "press") {
      const keyName = key || "Enter";
      const isEnter = keyName === "Enter";
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: keyName,
        code: isEnter ? "Enter" : keyName,
        windowsVirtualKeyCode: isEnter ? 13 : 0,
        nativeVirtualKeyCode: isEnter ? 13 : 0
      });
      await new Promise(r => setTimeout(r, 50));
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: keyName,
        code: isEnter ? "Enter" : keyName,
        windowsVirtualKeyCode: isEnter ? 13 : 0,
        nativeVirtualKeyCode: isEnter ? 13 : 0
      });
      return { success: true, detail: `Trusted hardware pressed ${keyName}` };
    }

    return { success: false, error: `Unknown CDP action: ${action}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

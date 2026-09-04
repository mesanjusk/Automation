// sidepanel/sidepanel.js
// Autonomous Browser Agent Orchestrator for WebCopilot AI

// --- State ---
let isRunning = false;
let currentTabId = null;
let actionHistory = [];
let lastOutcome = null;

const DEFAULT_SETTINGS = {
  provider: "gemini",
  apiKey: "",
  geminiModel: "gemini-3.6-flash",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  showBadges: true,
  maxSteps: 15
};

let settings = { ...DEFAULT_SETTINGS };

// --- DOM Elements ---
const chatContainer = document.getElementById("chat-container");
const welcomeBox = document.getElementById("welcome-box");
const promptInput = document.getElementById("prompt-input");
const btnSend = document.getElementById("btn-send");
const btnStop = document.getElementById("btn-stop");
const btnClear = document.getElementById("btn-clear");
const btnSettings = document.getElementById("btn-settings");
const statusIndicator = document.getElementById("status-indicator");
const pageContextTitle = document.getElementById("page-context-title");

// Modal Elements
const settingsModal = document.getElementById("settings-modal");
const btnCloseSettings = document.getElementById("btn-close-settings");
const btnSaveSettings = document.getElementById("btn-save-settings");
const settingProvider = document.getElementById("setting-provider");
const settingApiKey = document.getElementById("setting-api-key");
const settingGeminiModel = document.getElementById("setting-gemini-model");
const settingOllamaUrl = document.getElementById("setting-ollama-url");
const settingOllamaModel = document.getElementById("setting-ollama-model");
const settingShowBadges = document.getElementById("setting-show-badges");
const settingMaxSteps = document.getElementById("setting-max-steps");
const geminiSettingsGroup = document.getElementById("gemini-settings");
const ollamaSettingsGroup = document.getElementById("ollama-settings");

// --- Initialization ---
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await updateActiveTabContext();
  setupEventListeners();
});

async function loadSettings() {
  const stored = await chrome.storage.local.get("webcopilot_settings");
  if (stored.webcopilot_settings) {
    settings = { ...DEFAULT_SETTINGS, ...stored.webcopilot_settings };
    // Auto-migrate retired models
    if (settings.geminiModel === "gemini-2.0-flash" || settings.geminiModel === "gemini-1.5-flash") {
      settings.geminiModel = "gemini-3.6-flash";
      await chrome.storage.local.set({ webcopilot_settings: settings });
    }
  }
  populateSettingsUI();
}

function populateSettingsUI() {
  settingProvider.value = settings.provider;
  settingApiKey.value = settings.apiKey;
  settingGeminiModel.value = settings.geminiModel;
  settingOllamaUrl.value = settings.ollamaUrl;
  settingOllamaModel.value = settings.ollamaModel;
  settingShowBadges.checked = settings.showBadges;
  settingMaxSteps.value = settings.maxSteps;

  if (settings.provider === "gemini") {
    geminiSettingsGroup.classList.remove("hidden");
    ollamaSettingsGroup.classList.add("hidden");
  } else {
    geminiSettingsGroup.classList.add("hidden");
    ollamaSettingsGroup.classList.remove("hidden");
  }
}

async function saveSettings() {
  settings.provider = settingProvider.value;
  settings.apiKey = settingApiKey.value.trim();
  settings.geminiModel = settingGeminiModel.value.trim() || "gemini-3.6-flash";
  settings.ollamaUrl = settingOllamaUrl.value.trim() || "http://localhost:11434";
  settings.ollamaModel = settingOllamaModel.value.trim() || "llama3.2";
  settings.showBadges = settingShowBadges.checked;
  settings.maxSteps = parseInt(settingMaxSteps.value, 10) || 15;

  await chrome.storage.local.set({ webcopilot_settings: settings });
  settingsModal.classList.add("hidden");
}

function setupEventListeners() {
  // Input auto-resize & Enter to send
  promptInput.addEventListener("input", () => {
    promptInput.style.height = "auto";
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, 100)}px`;
  });

  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      startAgentTask();
    }
  });

  btnSend.addEventListener("click", startAgentTask);
  btnStop.addEventListener("click", stopAgentTask);
  btnClear.addEventListener("click", clearConversation);

  // Settings modal
  btnSettings.addEventListener("click", () => {
    populateSettingsUI();
    settingsModal.classList.remove("hidden");
  });
  btnCloseSettings.addEventListener("click", () => settingsModal.classList.add("hidden"));
  btnSaveSettings.addEventListener("click", saveSettings);
  settingProvider.addEventListener("change", () => {
    if (settingProvider.value === "gemini") {
      geminiSettingsGroup.classList.remove("hidden");
      ollamaSettingsGroup.classList.add("hidden");
    } else {
      geminiSettingsGroup.classList.add("hidden");
      ollamaSettingsGroup.classList.remove("hidden");
    }
  });

  // Suggestion chips
  document.querySelectorAll(".suggestion-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      promptInput.value = chip.getAttribute("data-prompt");
      startAgentTask();
    });
  });

  // Tab change listeners
  chrome.tabs.onActivated.addListener(updateActiveTabContext);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === currentTabId && changeInfo.status === "complete") {
      updateActiveTabContext();
    }
  });
}

async function updateActiveTabContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
    const title = tab.title || "Untitled Tab";
    const url = tab.url || "";
    pageContextTitle.textContent = `${title} (${new URL(url || "about:blank").hostname})`;
  }
}

function setStatus(text, type = "normal") {
  statusIndicator.textContent = text;
  statusIndicator.className = "status-badge";
  if (type === "thinking") statusIndicator.classList.add("thinking");
  if (type === "acting") statusIndicator.classList.add("acting");
}

function appendUserMessage(text) {
  if (welcomeBox) welcomeBox.remove();
  const div = document.createElement("div");
  div.className = "message user";
  div.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
  chatContainer.appendChild(div);
  scrollToBottom();
}

function appendAgentMessage(text) {
  const div = document.createElement("div");
  div.className = "message agent";
  div.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
  chatContainer.appendChild(div);
  scrollToBottom();
}

function appendStepCard(stepNumber, thought, tool, detail, result = "") {
  const div = document.createElement("div");
  div.className = "action-step-card";
  const toolClass = tool.toLowerCase();

  div.innerHTML = `
    <div class="step-header">
      <span class="step-number">Step ${stepNumber}</span>
      <span class="tool-badge ${toolClass}">${escapeHtml(tool)}</span>
    </div>
    ${thought ? `<div class="step-thought">"${escapeHtml(thought)}"</div>` : ""}
    <div class="step-detail">${escapeHtml(detail)}</div>
    ${result ? `<div class="step-result">&rarr; ${escapeHtml(result)}</div>` : ""}
  `;
  chatContainer.appendChild(div);
  scrollToBottom();
  return div;
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function clearConversation() {
  chatContainer.innerHTML = "";
  actionHistory = [];
  lastOutcome = null;
  setStatus("Ready");
}

// --- Content Script Injection Helpers ---

async function injectBadgeStyles(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/badge.css"]
    });
  } catch (e) {
    // Ignore if already injected
  }
}

async function runPageProbe(tabId) {
  await injectBadgeStyles(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/probe.js"]
  });
  return results?.[0]?.result;
}

async function runActionExecutor(tabId, actionPayload) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (payload) => {
      if (window.__webcopilot_execute) {
        return window.__webcopilot_execute(payload);
      }
      return { success: false, error: "Executor not ready" };
    },
    args: [actionPayload]
  });
  return results?.[0]?.result;
}

async function ensureExecutorInjected(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/executor.js"]
  });
}

// --- LLM API Callers ---

function buildSystemPrompt(task, snapshot, history, outcome) {
  const historyText = history.length > 0
    ? history.map((h, i) => `${i + 1}. [${h.action}] on [${h.ref || "none"}] -> ${h.detail || h.reason}`).join("\n")
    : "(No actions taken yet)";

  const outcomeText = outcome
    ? `LAST ACTION RESULT: ${outcome.success ? "SUCCESS" : "FAILED"}: ${outcome.detail || outcome.error}\nWHAT CHANGED: ${outcome.changed || "(not measured)"}`
    : "(First turn)";

  const lastAction = history[history.length - 1];
  let dynamicGuidance = "";

  if (lastAction && lastAction.action === "type") {
    dynamicGuidance = `
CRITICAL INSTRUCTION:
You typed into [${lastAction.ref || "input"}]. The prompt has NOT been submitted yet!
Do NOT call "wait"!
Your NEXT action MUST be to submit:
- Click the "Submit / Send prompt button" (look for the arrow button in the outline, e.g. [e15])
- OR press Enter on the input box: {"action": "press", "ref": "${lastAction.ref}", "key": "Enter"}
`;
  } else if (lastAction && lastAction.action === "wait") {
    dynamicGuidance = `
CRITICAL INSTRUCTION:
You called "wait". Look closely at the outline:
- If the prompt text is STILL sitting inside the input box and no progress/generation has started, it was NEVER SUBMITTED!
- DO NOT CALL "wait" AGAIN! Click the "Submit / Send prompt button" now!
`;
  }

  return `
You are WebCopilot, an expert autonomous browser automation agent.
Your objective: "${task}"

RULES:
1. ADDRESS ELEMENTS BY REF: Every interactive control on screen has a handle like [e1], [e2]. Use {"ref":"e1"}.
2. ONLY use refs present in the CURRENT outline below. Never guess or hallucinate refs.
3. ONE action per turn.
4. AVAILABLE ACTIONS:
   - "click": click a button, link, or input. Requires "ref".
   - "type": type text into an editable input. Requires "ref" and "value" (the text string).
   - "scroll": scroll the window. Requires "value" ("down" | "up" | "top" | "bottom").
   - "press": press a keyboard key (e.g. "Enter", "Tab", "Escape"). Requires "key": "Enter". Optional "ref".
   - "navigate": navigate directly to a full URL. Requires "value": "https://...".
   - "wait": wait for asynchronous loading. Requires "value": milliseconds (e.g. 2000).
   - "task_complete": the goal is 100% DONE and you have verified the actual result on screen. Requires "reason".
   - "task_fail": blocked by CAPTCHA, MFA, payment, or error. Requires "reason".
5. SUBMITTING PROMPTS & FORMS:
   - After typing into a prompt or search box, you MUST submit it.
   - To submit: Click the "Submit / Send prompt button" (or arrow icon next to the input), OR use {"action": "press", "ref": "<input_ref>", "key": "Enter"}. Do NOT click unrelated "Create" or "+" buttons in the top navigation bar!
   - If the text is still sitting in the input box and no loading indicator or generation has started, it was NOT submitted! Click the submit button!

6. CRITICAL EVIDENCE RULE FOR task_complete:
   - NEVER call "task_complete" based on an assumption (e.g. "I assume it is finished").
   - NEVER call "task_complete" while a video or generation is still in progress!
   - For media creation tasks: You must see the actual rendered video player, thumbnail, or download button before completing.
   - If generation is in progress or waiting, use {"action": "wait", "value": 5000} to continue monitoring the page!

CURRENT PAGE CONTEXT:
URL: ${snapshot.url}
Title: ${snapshot.title}
Scroll: ${snapshot.scroll.y}px / ${snapshot.scroll.height}px (at bottom: ${snapshot.scroll.atBottom})

INTERACTIVE ELEMENTS ON THIS PAGE:
${snapshot.outline || "(No visible interactive elements detected)"}

OUTCOME OF PREVIOUS ACTION:
${outcomeText}

PREVIOUS ACTIONS HISTORY:
${historyText}
${dynamicGuidance}
Respond ONLY with a valid JSON object matching this exact schema:
{
  "thought": "Brief explanation of what you see and why you chose this action",
  "action": "click" | "type" | "scroll" | "press" | "navigate" | "wait" | "task_complete" | "task_fail",
  "ref": "e1" (or null if not element-specific),
  "value": "string value for typing, scrolling, or navigating" (or null),
  "key": "Enter" (or null),
  "reason": "summary explanation if task_complete or task_fail" (or null)
}
`.trim();
}

async function callGemini(systemPrompt) {
  const primaryModel = settings.geminiModel || "gemini-3.6-flash";
  const candidateModels = [
    primaryModel,
    "gemini-3.6-flash",
    "gemini-3.8-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro-preview"
  ];
  const modelsToTry = candidateModels.filter((m, idx, self) => self.indexOf(m) === idx);

  let lastError = null;

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: "application/json"
            }
          })
        });

        if (response.status === 503 || response.status === 429) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `Server busy (HTTP ${response.status})`;
          lastError = new Error(errMsg);
          const delay = attempt * 2000;
          console.warn(`Model ${model} busy (${errMsg}). Retrying in ${delay / 1000}s (attempt ${attempt}/3)...`);
          setStatus(`Server busy, retrying in ${delay / 1000}s...`, "thinking");
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const msg = errorData?.error?.message || `Gemini API error: HTTP ${response.status}`;
          lastError = new Error(msg);
          console.warn(`Model ${model} returned error: ${msg}. Trying next fallback model...`);

          if (msg.includes("API key")) {
            throw new Error(msg);
          }

          setStatus(`Switching model...`, "thinking");
          await new Promise(r => setTimeout(r, 1000));
          break; // Try next model in list
        }

        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) throw new Error("Empty response from Gemini API");

        return JSON.parse(rawText);
      } catch (err) {
        lastError = err;
        if (err.message.includes("API key")) {
          throw err;
        }
        await new Promise(r => setTimeout(r, 1000));
        break;
      }
    }
  }

  const finalMessage = lastError?.message
    ? `Google AI servers are experiencing temporary high demand: "${lastError.message}". Please wait 10-15 seconds and try again.`
    : "Google AI servers are experiencing temporary high demand. Please wait a few seconds and try again.";
  throw new Error(finalMessage);
}

async function callOllama(systemPrompt) {
  const url = `${settings.ollamaUrl}/api/generate`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.ollamaModel || "llama3.2",
      prompt: systemPrompt,
      stream: false,
      format: "json"
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama error: HTTP ${response.status}. Make sure Ollama is running at ${settings.ollamaUrl}`);
  }

  const data = await response.json();
  return JSON.parse(data.response);
}

// --- Main Agent Loop ---

async function startAgentTask() {
  const task = promptInput.value.trim();
  if (!task || isRunning) return;

  // Verify settings
  if (settings.provider === "gemini" && !settings.apiKey) {
    populateSettingsUI();
    settingsModal.classList.remove("hidden");
    appendAgentMessage("⚠️ Please enter your free Gemini API key in Settings to begin.");
    return;
  }

  isRunning = true;
  promptInput.value = "";
  promptInput.style.height = "auto";
  btnSend.classList.add("hidden");
  btnStop.classList.remove("hidden");

  appendUserMessage(task);
  actionHistory = [];
  lastOutcome = null;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    appendAgentMessage("❌ Error: Could not find active Chrome tab.");
    stopAgentTask();
    return;
  }
  currentTabId = tab.id;

  let stepCount = 0;
  const maxSteps = settings.maxSteps || 15;
  let prevUrl = tab.url;

  try {
    await ensureExecutorInjected(currentTabId);

    while (isRunning && stepCount < maxSteps) {
      stepCount++;
      setStatus(`Thinking (Step ${stepCount})...`, "thinking");

      // 1. Sense: Probe current page
      let snapshot;
      try {
        snapshot = await runPageProbe(currentTabId);
      } catch (probeErr) {
        // Tab might be navigating
        await new Promise(r => setTimeout(r, 1200));
        snapshot = await runPageProbe(currentTabId);
      }

      if (!snapshot) {
        throw new Error("Unable to read elements on the current webpage.");
      }

      // Detect URL changes
      if (lastOutcome && snapshot.url !== prevUrl) {
        lastOutcome.changed = `Navigated to new page: ${snapshot.url}`;
        prevUrl = snapshot.url;
      }

      // 2. Brain: Prompt LLM
      const prompt = buildSystemPrompt(task, snapshot, actionHistory, lastOutcome);
      let decision;
      if (settings.provider === "gemini") {
        decision = await callGemini(prompt);
      } else {
        decision = await callOllama(prompt);
      }

      if (!decision || !decision.action) {
        throw new Error("Model returned an invalid response structure.");
      }

      // 3. Act: Handle Decisions
      if (decision.action === "task_complete") {
        setStatus("Completed", "normal");
        appendStepCard(stepCount, decision.thought, "DONE", "Task finished successfully");
        appendAgentMessage(`🎉 **Task Complete!**\n\n${decision.reason || "All steps finished."}`);
        await runActionExecutor(currentTabId, { action: "clearBadges" });
        break;
      }

      if (decision.action === "task_fail") {
        setStatus("Stopped", "normal");
        appendStepCard(stepCount, decision.thought, "FAILED", decision.reason || "Blocked");
        appendAgentMessage(`🛑 **Could not complete task:** ${decision.reason || "Blocked by page constraints or authentication."}`);
        await runActionExecutor(currentTabId, { action: "clearBadges" });
        break;
      }

      // Action execution
      setStatus(`Acting (Step ${stepCount})...`, "acting");
      let actionDetail = "";
      if (decision.action === "click") actionDetail = `Click [${decision.ref}]`;
      else if (decision.action === "type") actionDetail = `Type "${decision.value}" into [${decision.ref}]`;
      else if (decision.action === "scroll") actionDetail = `Scroll ${decision.value || "down"}`;
      else if (decision.action === "press") actionDetail = `Press key: ${decision.key || "Enter"}`;
      else if (decision.action === "navigate") actionDetail = `Navigate to ${decision.value}`;
      else if (decision.action === "wait") actionDetail = `Wait ${decision.value || 1000}ms`;

      const stepCard = appendStepCard(stepCount, decision.thought, decision.action, actionDetail);

      // Execute on page
      let execResult;
      if (decision.action === "navigate") {
        await chrome.tabs.update(currentTabId, { url: decision.value });
        await new Promise(r => setTimeout(r, 2000));
        execResult = { success: true, detail: `Navigated to ${decision.value}` };
      } else if (decision.action === "wait") {
        const ms = parseInt(decision.value, 10) || 1500;
        await new Promise(r => setTimeout(r, ms));
        execResult = { success: true, detail: `Waited ${ms}ms` };
      } else {
        // Attempt trusted CDP hardware execution first if coordinates or key known
        const targetMeta = snapshot.elements?.find(e => e.ref === decision.ref);
        let cdpSuccess = false;

        if (targetMeta && targetMeta.rect && (decision.action === "type" || decision.action === "click")) {
          const clientX = targetMeta.rect.clientX !== undefined ? targetMeta.rect.clientX : (targetMeta.rect.x - (snapshot.scroll?.y || 0));
          const clientY = targetMeta.rect.clientY !== undefined ? targetMeta.rect.clientY : (targetMeta.rect.y - (snapshot.scroll?.y || 0));
          const targetX = clientX + targetMeta.rect.width / 2;
          const targetY = clientY + targetMeta.rect.height / 2;

          try {
            const res = await chrome.runtime.sendMessage({
              type: "CDP_ACTION",
              tabId: currentTabId,
              action: decision.action,
              x: targetX,
              y: targetY,
              text: decision.value,
              key: decision.key || decision.value
            });
            if (res && res.success) {
              execResult = res;
              cdpSuccess = true;
            }
          } catch (cdpErr) {
            console.warn("CDP action error, using DOM executor:", cdpErr);
          }
        } else if (decision.action === "press") {
          try {
            const res = await chrome.runtime.sendMessage({
              type: "CDP_ACTION",
              tabId: currentTabId,
              action: "press",
              key: decision.key || decision.value || "Enter"
            });
            if (res && res.success) {
              execResult = res;
              cdpSuccess = true;
            }
          } catch (cdpErr) {}
        }

        // If CDP was not used or did not report success, fallback to DOM executor
        if (!cdpSuccess) {
          await ensureExecutorInjected(currentTabId);
          execResult = await runActionExecutor(currentTabId, {
            action: decision.action,
            ref: decision.ref,
            value: decision.value,
            key: decision.key
          });
        }
      }

      // Update step card with outcome
      if (execResult && stepCard) {
        const resultEl = stepCard.querySelector(".step-result") || document.createElement("div");
        resultEl.className = "step-result";
        resultEl.innerHTML = `&rarr; ${execResult.success ? "Success" : "Failed"}: ${escapeHtml(execResult.detail || execResult.error || "")}`;
        if (!stepCard.querySelector(".step-result")) stepCard.appendChild(resultEl);
      }

      actionHistory.push({
        action: decision.action,
        ref: decision.ref,
        value: decision.value,
        detail: actionDetail
      });

      lastOutcome = {
        success: execResult?.success !== false,
        detail: execResult?.detail || execResult?.error || "",
        changed: execResult?.success ? "Action executed on DOM" : "Action failed"
      };

      // Allow DOM to settle before next observation
      await new Promise(r => setTimeout(r, 1200));
    }

    if (stepCount >= maxSteps && isRunning) {
      appendAgentMessage(`⏱️ Reached maximum limit of ${maxSteps} steps. You can provide another instruction to continue.`);
      await runActionExecutor(currentTabId, { action: "clearBadges" });
    }
  } catch (err) {
    console.error("Agent error:", err);
    appendAgentMessage(`❌ **Error:** ${err.message}`);
    if (currentTabId) {
      await runActionExecutor(currentTabId, { action: "clearBadges" }).catch(() => {});
    }
  } finally {
    stopAgentTask();
  }
}

function stopAgentTask() {
  isRunning = false;
  btnStop.classList.add("hidden");
  btnSend.classList.remove("hidden");
  setStatus("Ready", "normal");
  if (currentTabId) {
    runActionExecutor(currentTabId, { action: "clearBadges" }).catch(() => {});
    chrome.runtime.sendMessage({ type: "CDP_DETACH", tabId: currentTabId }).catch(() => {});
  }
}

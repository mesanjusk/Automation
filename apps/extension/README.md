# WebCopilot AI - Autonomous Browser Automation Extension

An autonomous AI browser automation tool for Google Chrome with a native **Side Panel UI** (inspired by Claude for Chrome). It observes live webpages, stamps visual element reference badges (`[e1]`, `[e2]`, etc.), reasons with AI, and interacts with web pages by clicking, typing, scrolling, and extracting data.

Runs **100% free** using the **Google Gemini API Free Tier** (1,500 free requests/day) or **Local Ollama** (offline).

---

## Architecture: Why This Approach Works

```
Google Chrome
 ├── Active Webpage Tab
 │    ├── content/probe.js     (extracts DOM interactive elements & stamps visual badges)
 │    ├── content/executor.js  (dispatches clicks, React-friendly typing, scrolling)
 │    └── content/badge.css    (renders badges [e1], [e2] & action highlights)
 │
 ├── Native Chrome Side Panel (sidepanel/sidepanel.html & sidepanel.js)
 │    ├── Chat interface docked alongside the web page
 │    ├── Autonomous multi-turn agent loop (Observe -> Decide -> Act -> Verify)
 │    └── Direct REST integration with Google Gemini Free Tier or Ollama
 │
 └── background.js (service worker that opens side panel on toolbar icon click)
```

- **Zero Servers Needed:** No Redis, no MongoDB, no Docker, no Node background workers.
- **Your Existing Logins Just Work:** Runs directly on your tabs where you are already signed into your accounts. No bot detection flags or remote debugging port issues.
- **Set-of-Mark Element Ref Accuracy:** Every button, link, and input is labeled (`e1`, `e2`), preventing the AI from clicking the wrong element.

---

## 30-Second Quick Start

### Step 1: Load into Chrome
1. Open **Google Chrome**.
2. Navigate to `chrome://extensions/`.
3. In the top-right corner, turn on **Developer mode**.
4. Click **Load unpacked** (top-left).
5. Select the folder:
   ```
   C:\Users\91940\.gemini\antigravity\scratch\browser-agent-extension
   ```
6. The **WebCopilot AI** extension will appear in your Chrome toolbar!

### Step 2: Configure Your Free AI Key
1. Click the **WebCopilot** extension icon in your toolbar to open the **Side Panel**.
2. Click the ⚙️ **Settings** gear icon in the top right.
3. Get a 100% free key from [Google AI Studio](https://aistudio.google.com/app/apikey) (takes 30 seconds, no credit card required).
4. Paste your key into the **Gemini API Key** field and click **Save Settings**.
   *(Alternatively, select **Ollama** if you run local models like `llama3.2` or `qwen2.5` on `http://localhost:11434`)*.

### Step 3: Run Your First Automation!
1. Open any website in Chrome (e.g. [Google](https://www.google.com), [Wikipedia](https://www.wikipedia.org), or [Amazon](https://www.amazon.com)).
2. In the Side Panel, give WebCopilot a task, such as:
   - *"Search for James Webb Space Telescope and click on the Wikipedia article"*
   - *"Find the search bar on this page, type 'mechanical keyboards', and submit"*
   - *"Summarize the main content of this webpage"*
3. Watch WebCopilot highlight elements, execute the steps in real-time, and report back when finished!

---

## File Structure

```
browser-agent-extension/
├── manifest.json              # Chrome Manifest V3 declaration
├── background.js              # Service worker (opens sidepanel on click)
├── icons/                     # Extension icons (16, 48, 128)
├── content/
│   ├── probe.js               # Injects into tab to discover and badge interactive elements
│   ├── executor.js            # Simulates clicks, input events, scrolling, key presses
│   └── badge.css              # Styling for element reference badges and action highlights
├── sidepanel/
│   ├── sidepanel.html         # Native Chrome side panel chat UI
│   ├── sidepanel.css          # Sleek modern styling (dark & light mode)
│   └── sidepanel.js          # Core agent orchestrator, prompt builder & LLM caller
└── README.md                  # Documentation
```

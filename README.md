# Browser Automation OS

A generic, reusable browser-automation platform: a visual workflow engine, an
AI (Gemini) browser agent, and long-running Playwright workers, all driven
through an HTTP API so any other application — a CRM, an ERP, a cron job —
can trigger and monitor automations without knowing anything about
Playwright.

It is **not** built around any one target site (Amazon, Instagram, etc). You
define workflows once — login, navigate, extract, decide, download — against
whatever websites you're authorized to automate, and reuse them.

## Architecture

```
Web dashboard / Public API  (Next.js, Vercel)
            |
            |  enqueue task
            v
        Redis (BullMQ)
            |
            v
   Browser Worker  (Node, Render — long-running, NOT serverless)
            |
            v
   Playwright + Chromium  --->  target website
            |
            v
        MongoDB (tasks, logs, screenshots, profiles, credentials)
```

The web app and the worker are **separate deployables** on purpose: Vercel
serverless functions cannot host a long-lived Chromium process, so the
worker always runs somewhere with a persistent process (Render, Fly, a VM,
your own Docker host). They only share MongoDB and Redis.

### Monorepo layout

```
/apps
  /web         Next.js dashboard + public API (deploy to Vercel)
  /worker      BullMQ consumer + Playwright + scheduler (deploy to Render)
  /test-site   Tiny local fixture website used by the demo automation & e2e

/packages
  /shared              Zod schemas, enums, types shared everywhere
  /database            Mongoose models + connection helper
  /security            AES-256-GCM encryption, API key hashing, rate limiting
  /browser             Playwright session mgmt, self-healing selector resolver, node executors
  /ai                  Gemini abstraction, agent tool-call validation, NL->workflow generator
  /automation-engine   The workflow graph interpreter (retries, branching, loops, AI, human approval)
  /queue               BullMQ queue definitions + Redis connection
  /storage             StorageProvider abstraction (local disk / Cloudinary)

/scripts
  seed-demo.ts         Seeds the "Demo Website Data Extraction" automation
  login-helper.ts      Opens a real headed browser so you can log in manually
```

## Core concepts

- **Workflow** — a graph of typed nodes (`NAVIGATE`, `CLICK`, `TYPE`,
  `EXTRACT_TEXT`, `WAIT_FOR_TEXT`, `SCROLL_TO_ELEMENT`, `PROBE_PAGE`,
  `WAIT_FOR_STATE`, `FLOW_NAVIGATE`, `CONDITION`, `LOOP`, `FOR_EACH`,
  `PARSE_JSON`, `AI_DECISION`, `HUMAN_APPROVAL`, `WEBHOOK`, …). Versioned —
  saving never overwrites a published version, it creates a new one.
- **Automation** — a named, API-triggerable wrapper around a published
  workflow (+ default browser profile / callback URL / schedule).
- **Task** — one run of an automation. Goes through
  `QUEUED → STARTING → RUNNING → COMPLETED|FAILED|CANCELLED`, or
  `WAITING_FOR_HUMAN` if it hits a `HUMAN_APPROVAL` node or the AI agent
  reports something like a CAPTCHA/MFA it can't handle itself.
- **Browser Profile** — a persistent identity (cookies/localStorage,
  viewport, locale, timezone), encrypted at rest, reusable across runs so you
  don't have to log in every time.
- **Credential** — an encrypted secret referenced from a workflow as
  `{{secret:name}}`. Resolved just-in-time inside the worker and substituted
  directly into the Playwright action — it is **never** written into the
  variable bag, so it can't leak into an AI prompt, an execution log, or a
  screenshot.
- **AI agent** — only ever picks from a fixed, validated tool list
  (`browser_click`, `browser_type`, …). It cannot execute arbitrary code. Every
  action is schema-validated before it touches the browser, capped by
  `MAX_AI_ACTIONS`, and optionally restricted to a domain allowlist.
- **Element refs** — the accuracy mechanism. Every snapshot stamps a handle
  (`data-bos-ref="e12"`) on each visible control and shows the agent
  `[e12] button "Continue"`. The agent then acts on `e12`, so there is no lossy
  round trip from "the element I was shown" through a description and back to
  "an element matching that description" — the classic source of an agent
  clicking the wrong one of five identical buttons. Refs live on the node, so
  they survive a re-render that moves the element, and a ref that has genuinely
  gone fails fast and says so instead of resolving to something else.
- **Observe → act → verify** — after every mutating action the executor waits
  for the DOM to stop changing, and the next observation is handed to the agent
  together with a diff of what actually changed ("URL changed…", "Submit is now
  enabled", or "NOTHING CHANGED — your last action had no visible effect").
  Without that feedback a model cannot tell a click that worked from one that
  hit a disabled control, and it builds its next steps on an action that never
  happened. The engine also stops an agent that issues the same action four
  times running.
- **Self-healing selectors** — each element target tries, in order:
  `ref` → `data-testid` → CSS → role → text → aria-label → nearby text → XPath →
  AI visual identification (Gemini vision, coordinates only as a last
  resort). Whichever strategy actually worked is recorded on the execution
  step. Matches are restricted to elements that are actually visible (set
  `visibleOnly: false` to opt out), `editable: true` skips past read-only
  look-alikes, and `preferSemantic: true` tries role/text/aria before CSS.
- **Live page discovery** — `PROBE_PAGE` inspects the real DOM — including
  same-origin iframes — and reports every visible control with its ref, role,
  accessible name, aria-label, current value, editability and a generated
  selector, plus open modal dialogs, live-region announcements and how far the
  page can still scroll. Workflows interpolate what it found
  (`{{flowUi.composer.cssPath}}`) instead of hard-coding selectors for an app
  whose markup changes underneath them.
- **Waiting on the page, not the clock** — `WAIT_FOR_TEXT` blocks until the
  site's own confirmation appears (or a spinner's text disappears), which is
  both faster than a guessed sleep when the site is quick and correct when it
  is slow.
- **Reading a model's reply** — `PARSE_JSON` takes text a workflow scraped out
  of a page and parses it in the worker, not in a page script. It repairs what
  is safely repairable (a markdown fence, a trailing comma, typographic quotes,
  a raw newline, and the one that actually bites on long outputs: an unescaped
  `"` inside a string value) and, when it cannot, reports the text *around* the
  failure and whether the reply looks truncated — which means it was read
  before it had finished being written, a different problem with a different
  fix. It fails `TRANSIENT`/retryable, and with `continueOnError` a workflow can
  branch on `<variableName>Error` and ask the model to try again instead of
  ending the run.
- **State-aware site drivers** — `FLOW_NAVIGATE` classifies whichever Google
  Flow screen is really on display (landing / Google sign-in / project
  workspace / generation UI / generating / clip ready / error) and advances
  through it, and `WAIT_FOR_STATE` polls that observed state within a bounded
  timeout instead of sleeping for a fixed period. Each transition is
  screenshotted under a stable name (`flow_landing`, `flow_after_create`,
  `flow_workspace`, `flow_generation_ui`, `flow_prompt_submitted`,
  `flow_generating`, `flow_clip_complete`, `flow_error`) so a failed run can be
  diagnosed from the dashboard. A profile that is not signed in to Google
  fails as `GOOGLE_LOGIN_REQUIRED`, not as a selector timeout.
- **Video Studio** — idea → ChatGPT (the user's logged-in browser tab, no paid
  API) → a structured shot-by-shot production plan → Google Flow, generating
  every planned clip in order with the continuity lock carried into each
  prompt. Runs with `executionTarget: "local"`, which the worker claims by
  polling MongoDB — no Redis, so cloud/Render automations are unaffected.
  Reading the plan is split in three: a page script that only *waits* (keyed on
  ChatGPT's own stop-streaming and copy-message controls, so a reply that pauses
  mid-thought is not mistaken for a finished one), `PARSE_JSON`, and — if the
  reply still will not parse — a correction round-trip that tells the planner
  exactly what was wrong and reads its next answer. Shot prompts are composed in
  the worker (`flowMission.ts`), so a stray character in one shot can no longer
  take down the run.

## Local development

### Option A — Docker Compose (fastest)

```bash
cp .env.example .env
# fill in ENCRYPTION_KEY (openssl rand -hex 32) and GEMINI_API_KEY at minimum
docker compose up --build
```

This starts MongoDB, Redis, the test site (`:4100`), the worker (`:4000`,
health at `/health`), and the web dashboard (`:3000`).

Then, in another shell, seed an admin user and the demo automation:

```bash
npm install
npm run seed          # creates an admin user + a bootstrap API key
npm run seed:demo      # creates "Demo Website Data Extraction" against apps/test-site
```

Log in at `http://localhost:3000/login` with the admin credentials printed
by `npm run seed`.

### Option B — run everything natively

Requires local MongoDB and Redis (or point `MONGODB_URI`/`REDIS_URL` at
hosted ones).

```bash
npm install
npm run seed
npm run dev:test-site   # terminal 1
npm run dev:worker      # terminal 2 — needs Playwright's Chromium: npx playwright install chromium
npm run dev:web         # terminal 3
```

### Logging into a real (or the demo) website manually

The dashboard's Profiles page can't drive a live remote browser window over
HTTP by itself — instead, use the bundled CLI, which opens a **real, visible**
Chromium window on your machine:

```bash
npm run login-helper -- --profile=<browserProfileId> --url=https://example.com/login
```

Log in (solve any CAPTCHA/MFA yourself — the platform never attempts to
bypass these), then just close the window. The session (cookies +
localStorage) is encrypted and saved onto that profile; any automation using
it starts already logged in. The Profiles page also supports exporting /
importing a profile's session as JSON if you need to move it between
environments.

### Tests

```bash
npm test
```

246 unit/integration tests cover workflow validation, the self-healing
selector fallback chain (including ref binding, stale-ref recovery and iframe
scoping), page-snapshot rendering and change detection, the agent tool
adapter and its safety checks, the agent prompt contract, the retry/backoff
policy, the engine's control flow (branching, loops, human-approval pausing,
cancellation, the repeated-action guard, `PARSE_JSON` and its repairs), the
lenient JSON reader on its own, the Video Studio mission builder, BullMQ job
shaping, request-schema validation for the public API, and webhook HMAC
signing.

Files ending `.browser.test.ts` drive a real headless Chromium: they prove the
probe reads a real DOM correctly, that a ref survives a re-render and still
resolves to the same element, that a removed ref fails fast, that the executor
types into and clicks the exact elements a snapshot named, and that the
stability wait both settles and gives up within its budget. They skip
themselves with a warning if no Chromium is available.

### The local e2e fixture

`apps/test-site` is a tiny Express site (login, search, results table,
file download, a form, a success page) that exists purely so the platform
has something safe to automate in tests and demos — never point a real
automation at a third-party site inside a test suite. `npm run seed:demo`
wires up a full login → search → extract → conditional-download workflow
against it (demo credentials: `demo` / `demo123`, stored in the Credentials
page as `test_site_password`).

## Deployment

### 1. MongoDB Atlas
Create a cluster, a database user, and allow network access from both
Vercel and Render. Copy the connection string into `MONGODB_URI`.

### 2. Redis (Render Redis, Upstash, or any Redis-compatible provider)
Copy the connection string into `REDIS_URL` for **both** the web and worker
deployments — they must point at the same instance.

### 3. Worker → Render

**Use the Docker environment, not Render's native Node buildpack.** This repo
is an npm workspaces monorepo, and Render's native Node buildpack combined
with a per-service "Root Directory" set to a subfolder (e.g. `apps/worker`)
does not reliably install root-level devDependencies or resolve sibling
`@bos/*` workspace packages — it's designed for single-package repos. The
included `render.yaml` Blueprint avoids this entirely by building
`apps/worker/Dockerfile` with the **repo root** as the Docker build context
(the Dockerfile itself does one `npm install --workspaces --include-workspace-root`
against the whole monorepo, then builds just that one app).

- Easiest: in the Render dashboard, **New → Blueprint**, point it at this repo
  — it reads `render.yaml` and creates the worker (and optionally web)
  service correctly configured already. Fill in the secret env vars it lists
  as `sync: false` (`MONGODB_URI`, `REDIS_URL`, `ENCRYPTION_KEY`,
  `GEMINI_API_KEY`, `CLOUDINARY_*`, `API_BASE_URL`).
- Manual setup instead: New → Web Service → **Environment: Docker** →
  Dockerfile Path `apps/worker/Dockerfile` → Docker Build Context `.` (repo
  root) → do **not** set a Root Directory. Health check path `/health`.
- `STORAGE_PROVIDER=cloudinary` in production — Render's disk isn't
  guaranteed persistent across deploys unless you attach a persistent disk.
- This is the **only** piece that needs to be always-on with a real
  filesystem/browser — never deploy it as a Vercel function.

**Using Render's free plan?** `render.yaml` is set to `plan: free` for both
services. Free Web Services spin down after ~15 minutes of no HTTP traffic —
fine for the dashboard (a visit wakes it), but the worker needs to be
running continuously to consume queued BullMQ jobs, even with nobody looking
at the dashboard. A task queued while it's asleep just waits until something
wakes the service back up.

Mitigation included here: `.github/workflows/keep-worker-warm.yml` pings the
worker's `/health` endpoint every 10 minutes via GitHub Actions (free), so it
never gets the chance to sleep. Set a repo secret `WORKER_HEALTH_URL` to your
deployed worker's health URL (e.g. `https://browser-automation-worker.onrender.com/health`)
under Settings → Secrets and variables → Actions, and enable the workflow.
Note GitHub only runs *scheduled* workflows from the repo's default branch —
merge this branch there, or trigger it manually via workflow_dispatch to test.
This keeps a free plan usable for testing; for anything you actually depend
on, moving just the worker to a paid plan (Starter, cheapest at time of
writing) is more reliable than pinging around a sleep timer.

### 3b. If a Render build fails with "Cannot find name 'process'/'Buffer'"

That signature means the build ran against a **stale cached `node_modules`**:
Render restored a cache from before a dependency change and plain
`npm install` reported "up to date" without installing the new packages
(`@types/node` et al.). Three layers of defense exist:

1. **Use `npm ci` in any non-Docker Build Command** (e.g.
   `npm ci && npm run build`) — it wipes `node_modules` and installs exactly
   what `package-lock.json` pins, making a stale cache impossible.
2. The root `npm run build` now runs `scripts/preflight.mjs` first, which
   fails immediately with a clear message (instead of hundreds of TS errors)
   if `@types/node`/`typescript` can't be resolved from every workspace.
3. Or clear the Render service's build cache once (Manual Deploy → "Clear
   build cache & deploy"). The Docker services in `render.yaml` are immune —
   their `npm install` always runs inside a fresh build stage.

### 4. Web + API → Vercel
- Import the repo, set the root directory to `apps/web` (or use
  `vercel.json` build settings pointing there) with the monorepo's root
  `package.json` workspaces still resolvable — Vercel's npm/yarn/pnpm
  monorepo support handles this automatically when the project root stays
  at the repo root and "Root Directory" is set to `apps/web`.
- Env vars: `MONGODB_URI`, `REDIS_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
  (your Vercel URL), `ENCRYPTION_KEY` (must match the worker's — it's how
  cookies/credentials round-trip), `GEMINI_API_KEY`, `STORAGE_PROVIDER=cloudinary`
  + `CLOUDINARY_*`.
- The web app never launches Playwright — it only enqueues jobs and reads
  MongoDB, so it's a perfectly ordinary Next.js deployment.

### 5. Point your CRM at it
```
POST https://<your-app>.vercel.app/api/v1/automations/run
X-API-Key: bos_live_...
Content-Type: application/json

{
  "automation": "supplier-stock-check",
  "input": { "products": ["P001", "P002"] },
  "callbackUrl": "https://your-crm.com/api/automation/callback"
}
```
Create the API key from the dashboard's **API** page. The worker POSTs a
signed `automation.completed` / `automation.failed` / `automation.human_intervention_required`
event to `callbackUrl` (or to any Webhook configured on the **Webhooks**
page) when the task resolves.

## Security notes

- Credentials and browser-profile session state are encrypted at rest with
  AES-256-GCM (`ENCRYPTION_KEY`, 32 random bytes — `openssl rand -hex 32`).
  Never commit a real key.
- API keys are stored as SHA-256 hashes, never in plaintext.
- The AI agent only calls a fixed, schema-validated tool list — it cannot
  run arbitrary code, and every action is checked against `MAX_AI_ACTIONS`
  and (optionally) a domain allowlist before it reaches Playwright. The
  allowlist covers `browser_new_tab` as well as `browser_navigate`, and is
  re-checked against the URL the browser is *actually* showing before each
  decision — a click on an outbound link never calls a navigation tool, so a
  pre-flight check alone would not hold the boundary. Crossing it ends the run;
  a merely malformed tool call does not.
- Snapshots stamp a `data-bos-ref` attribute on visible controls. That is the
  only way the platform writes to a target page's DOM, and it adds nothing that
  is submitted, transmitted or persisted by the site.
- The platform never attempts to defeat CAPTCHA/MFA/bot-detection; any such
  wall pauses the task as `WAITING_FOR_HUMAN` for a person to resolve.

## What's intentionally out of scope for this pass

Being upfront about the corners cut to keep this a coherent, working system
rather than 38 half-finished sections:

- **No in-browser live remote control** of a running Chromium session (e.g.
  streaming it over WebRTC/VNC into the dashboard). The Live Sessions and
  Task Detail pages show real-time status, logs and screenshots via polling,
  and manual logins go through the `login-helper` CLI's real local browser
  window instead.
- The visual workflow builder edits a node's `config` as JSON rather than a
  bespoke form per node type (30+ node types) — it's the same data either
  way, just less hand-holding for the free-form fields.
- The scheduler is a 60-second DB-poll loop inside the worker process, not a
  separate cron service — simple, and needs no extra infrastructure, but
  isn't sub-minute precision.
- Rate limiting is in-memory per worker process; fine for a single API
  instance, swap for a Redis-backed limiter if you scale the web app
  horizontally.

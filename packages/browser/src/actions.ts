import path from "node:path";
import type { NodeType, SelectorStrategy, WorkflowNode } from "@bos/shared";
import type { BrowserSession } from "./session";
import { resolveTarget, type VisualFallback } from "./selectorResolver";
import { probePage, summariseProbe } from "./pageProbe";
import { waitForPageStable } from "./pageStability";
import { collectNotices, renderOutline } from "./agentSnapshot";
import { classifyFlowState, toFlowStates } from "./flowState";
import { navigateFlow, waitForFlowState, type EmitScreenshot } from "./flowNavigator";
import { interpolate, interpolateTarget, interpolateWithSecrets } from "./interpolate";

export interface BrowserActionContext {
  variables: Record<string, unknown>;
  downloadDir: string;
  visualFallback?: VisualFallback;
  /** Resolves {{secret:name}} tokens (credentials) just-in-time; never persisted to variables/logs. */
  resolveSecret?: (name: string) => Promise<string | undefined>;
  /**
   * Persists an extra, named screenshot mid-step. Long-running nodes (the Flow
   * navigator, state waits) capture several transitions each, including on the
   * failure path where the step's own screenshot would never be returned.
   */
  emitScreenshot?: EmitScreenshot;
  log?: (message: string) => void;
}

export interface BrowserActionResult {
  output?: unknown;
  selectorStrategyUsed?: SelectorStrategy;
  screenshotBuffer?: Buffer;
  downloadedFilePath?: string;
}

// Node types this package knows how to execute directly against a page.
// Everything else (CONDITION, LOOP, FOR_EACH, SET_VARIABLE, GET_VARIABLE,
// AI_DECISION, HUMAN_APPROVAL, WEBHOOK, END, FAIL) is control flow handled
// by packages/automation-engine.
export const BROWSER_NODE_TYPES: NodeType[] = [
  "NAVIGATE",
  "CLICK",
  "TYPE",
  "CLEAR",
  "SELECT",
  "HOVER",
  "PRESS_KEY",
  "WAIT",
  "WAIT_FOR_SELECTOR",
  "WAIT_FOR_NAVIGATION",
  "WAIT_FOR_TEXT",
  "SCROLL_TO_ELEMENT",
  "EXTRACT_TEXT",
  "EXTRACT_ATTRIBUTE",
  "SCREENSHOT",
  "UPLOAD_FILE",
  "DOWNLOAD_FILE",
  "NEW_TAB",
  "SWITCH_TAB",
  "CLOSE_TAB",
  "GO_BACK",
  "GO_FORWARD",
  "SCROLL",
  "EXECUTE_JS",
  "PROBE_PAGE",
  "WAIT_FOR_STATE",
  "FLOW_NAVIGATE",
];

export async function executeBrowserAction(
  session: BrowserSession,
  node: WorkflowNode,
  ctx: BrowserActionContext
): Promise<BrowserActionResult> {
  const cfg = node.config;
  const page = session.activePage;

  switch (node.type) {
    case "NAVIGATE": {
      const url = interpolate(cfg.url, ctx.variables);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: node.timeout || 30_000 });
      return { output: { url: page.url() } };
    }

    case "CLICK": {
      const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
      const point = getVisualPoint(locator);
      if (point) await page.mouse.click(point.x, point.y);
      else await locator.click({ timeout: node.timeout || 10_000 });
      await settle(page, node, ctx);
      return { selectorStrategyUsed: strategy };
    }

    case "TYPE": {
      const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
      const value = await interpolateWithSecrets(cfg.value, ctx.variables, ctx.resolveSecret);
      const timeout = node.timeout || 10_000;
      try {
        await locator.fill(value, { timeout });
      } catch (err) {
        // Rich-text composers (Lexical, ProseMirror, Quill) reject fill()
        // because they own their DOM and only react to real key events.
        // Typing for real is slower but it is the difference between the text
        // landing and the step failing on an editor the site clearly supports.
        ctx.log?.(`fill() was rejected (${(err as Error).message.split("\n")[0]}); typing the value key by key instead.`);
        await locator.click({ timeout });
        await locator.press("ControlOrMeta+a").catch(() => undefined);
        await locator.pressSequentially(value, { timeout, delay: 8 });
      }
      await settle(page, node, ctx);
      return { selectorStrategyUsed: strategy };
    }

    case "CLEAR": {
      const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
      await locator.fill("");
      await settle(page, node, ctx);
      return { selectorStrategyUsed: strategy };
    }

    case "SELECT": {
      const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
      const value = interpolate(cfg.value, ctx.variables);
      await locator.selectOption(value);
      await settle(page, node, ctx);
      return { selectorStrategyUsed: strategy };
    }

    case "HOVER": {
      const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
      await locator.hover();
      return { selectorStrategyUsed: strategy };
    }

    case "PRESS_KEY": {
      if (cfg.target) {
        const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
        await locator.press(cfg.key || "Enter");
        await settle(page, node, ctx);
        return { selectorStrategyUsed: strategy };
      }
      await page.keyboard.press(cfg.key || "Enter");
      await settle(page, node, ctx);
      return {};
    }

    case "WAIT": {
      await page.waitForTimeout(cfg.ms ?? 1000);
      return {};
    }

    case "WAIT_FOR_SELECTOR": {
      const { strategy } = await resolveTargetOrThrow(page, node, ctx, node.timeout || 15_000);
      return { selectorStrategyUsed: strategy };
    }

    case "WAIT_FOR_NAVIGATION": {
      await page.waitForLoadState("networkidle", { timeout: node.timeout || 30_000 });
      return { output: { url: page.url() } };
    }

    case "WAIT_FOR_TEXT": {
      // Waiting on a phrase the page itself shows ("Payment received",
      // "Uploading…" disappearing) beats sleeping for a guessed number of
      // seconds: it is both faster when the site is quick and correct when it
      // is slow.
      const needle = interpolate(cfg.text, ctx.variables);
      if (!needle) throw new Error(`Node "${node.id}" (WAIT_FOR_TEXT) requires config.text`);
      const wantAbsent = cfg.absent === true;
      const budget = node.timeout || 30_000;
      const started = Date.now();
      const pollMs = Math.max(100, cfg.pollMs ?? 300);
      while (Date.now() - started < budget) {
        const body = await page.evaluate("document.body ? document.body.innerText : ''").catch(() => "");
        const seen = String(body).toLowerCase().includes(needle.toLowerCase());
        if (seen !== wantAbsent) {
          return { output: { text: needle, present: seen, waitedMs: Date.now() - started } };
        }
        await page.waitForTimeout(pollMs);
      }
      throw new Error(
        `Timed out after ${budget}ms waiting for the text ${JSON.stringify(needle)} to ` +
          `${wantAbsent ? "disappear from" : "appear on"} ${page.url()}.`
      );
    }

    case "SCROLL_TO_ELEMENT": {
      const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
      await locator.scrollIntoViewIfNeeded({ timeout: node.timeout || 10_000 });
      return { selectorStrategyUsed: strategy };
    }

    case "EXTRACT_TEXT": {
      // No target means "read the page" — the agent's way of catching up on
      // content it cannot act on, without inventing a selector for the body.
      if (!node.config.target) {
        const report = await probePage(page, { maxElements: 1, maxTextLength: cfg.maxTextLength ?? 8000, includeFrames: false });
        return { output: { text: report.visibleText, url: report.url, title: report.title } };
      }
      const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
      const text = (await locator.textContent())?.trim() ?? "";
      return { output: { text }, selectorStrategyUsed: strategy };
    }

    case "EXTRACT_ATTRIBUTE": {
      const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
      const value = await locator.getAttribute(cfg.attribute || "href");
      return { output: { value }, selectorStrategyUsed: strategy };
    }

    case "SCREENSHOT": {
      const buffer = await page.screenshot({ fullPage: true });
      return { screenshotBuffer: buffer };
    }

    case "UPLOAD_FILE": {
      const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
      const filePath = interpolate(cfg.filePath, ctx.variables);
      await locator.setInputFiles(filePath);
      return { selectorStrategyUsed: strategy };
    }

    case "DOWNLOAD_FILE": {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: node.timeout || 30_000 }),
        (async () => {
          if (cfg.target) {
            const { locator } = await resolveTargetOrThrow(page, node, ctx);
            await locator.click();
          }
        })(),
      ]);
      const suggested = download.suggestedFilename();
      const destination = path.join(ctx.downloadDir, `${Date.now()}-${suggested}`);
      await download.saveAs(destination);
      return { downloadedFilePath: destination, output: { fileName: suggested } };
    }

    case "NEW_TAB": {
      const url = cfg.url ? interpolate(cfg.url, ctx.variables) : undefined;
      await session.newTab(url);
      return { output: { tabIndex: session.activeTabIndex } };
    }

    case "SWITCH_TAB": {
      session.switchTab(cfg.tabIndex ?? 0);
      return { output: { tabIndex: session.activeTabIndex } };
    }

    case "CLOSE_TAB": {
      await session.closeTab(cfg.tabIndex);
      return { output: { tabIndex: session.activeTabIndex } };
    }

    case "GO_BACK": {
      await page.goBack({ waitUntil: "domcontentloaded" });
      return { output: { url: page.url() } };
    }

    case "GO_FORWARD": {
      await page.goForward({ waitUntil: "domcontentloaded" });
      return { output: { url: page.url() } };
    }

    case "SCROLL": {
      const direction = cfg.scrollDirection ?? "down";
      if (direction === "top") await page.evaluate(() => window.scrollTo(0, 0));
      else if (direction === "bottom")
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      else await page.mouse.wheel(0, direction === "up" ? -600 : 600);
      return {};
    }

    case "PROBE_PAGE": {
      // Inspect what is really on the page: roles, accessible names, aria
      // labels and generated selectors, plus the Flow state they imply.
      const report = await probePage(page, { maxElements: cfg.maxElements ?? 120 });
      const classification = classifyFlowState(report);
      ctx.log?.(`Probed ${report.url} -> ${classification.state}: ${classification.reason}`);
      const buffer = cfg.screenshot === false ? undefined : await page.screenshot({ fullPage: false });
      return {
        output: {
          state: classification.state,
          reason: classification.reason,
          url: report.url,
          title: report.title,
          composer: classification.composer ?? null,
          submit: classification.submit ?? null,
          primaryAction: classification.primaryAction ?? null,
          errorText: classification.errorText ?? null,
          discovered: summariseProbe(report, 25),
          outline: renderOutline(report, cfg.maxElements ?? 60),
          notices: collectNotices(report),
          elements: report.elements.slice(0, 40),
        },
        screenshotBuffer: buffer,
      };
    }

    case "WAIT_FOR_STATE": {
      // Bounded polling on the real page state — never a fixed sleep.
      const observation = await waitForFlowState(page, {
        states: toFlowStates(cfg.states, ["GENERATION_UI"]),
        failStates: toFlowStates(cfg.failStates),
        timeoutMs: node.timeout || 120_000,
        pollMs: cfg.pollMs,
        requireNewVideo: cfg.requireNewVideo === true,
        stepId: node.id,
        screenshotName: cfg.screenshotName,
        emitScreenshot: ctx.emitScreenshot,
        log: ctx.log,
      });
      return {
        output: {
          state: observation.classification.state,
          reason: observation.classification.reason,
          url: observation.report.url,
          composer: observation.classification.composer ?? null,
          submit: observation.classification.submit ?? null,
        },
      };
    }

    case "FLOW_NAVIGATE": {
      const { observation, history } = await navigateFlow(session, {
        goal: toFlowStates(cfg.goalState ? [cfg.goalState] : undefined, ["GENERATION_UI"])[0],
        maxSteps: cfg.maxSteps,
        timeoutMs: node.timeout || 180_000,
        pollMs: cfg.pollMs,
        stepId: node.id,
        emitScreenshot: ctx.emitScreenshot,
        log: ctx.log,
      });
      return {
        output: {
          state: observation.classification.state,
          reason: observation.classification.reason,
          url: observation.report.url,
          title: observation.report.title,
          history,
          composer: observation.classification.composer ?? null,
          submit: observation.classification.submit ?? null,
          discovered: summariseProbe(observation.report, 25),
        },
      };
    }

    case "EXECUTE_JS": {
      // Author-defined script from the workflow definition (not AI-generated
      // — the AI agent never gets a code-execution tool, see packages/ai).
      const result = await page.evaluate(new Function(`return (${cfg.script})()`) as never);
      return { output: { result } };
    }

    default:
      throw new Error(`Node type "${node.type}" is not a browser action node`);
  }
}

/**
 * Lets the page finish reacting before the next observation is taken.
 *
 * Every mutating action ends here. Skipping it is what produces the classic
 * agent failure loop: click, observe the pre-click DOM, conclude the click did
 * nothing, click again — and now the form is submitted twice.
 */
async function settle(
  page: Parameters<typeof waitForPageStable>[0],
  node: WorkflowNode,
  ctx: BrowserActionContext
): Promise<void> {
  if (node.config.settle === false) return;
  const budget = node.config.settleMs ?? 3000;
  if (budget <= 0) return;
  const result = await waitForPageStable(page, { timeoutMs: budget }).catch(() => null);
  if (result && !result.settled) {
    ctx.log?.(`Page was still changing ${result.waitedMs}ms after ${node.type} (${result.reason}).`);
  }
}

async function resolveTargetOrThrow(
  page: Parameters<typeof resolveTarget>[0],
  node: WorkflowNode,
  ctx: BrowserActionContext,
  timeout?: number
) {
  if (!node.config.target) {
    throw new Error(`Node "${node.id}" (${node.type}) requires a target selector`);
  }
  const target = interpolateTarget(node.config.target as Record<string, unknown>, ctx.variables);
  return resolveTarget(page, target, { timeout: timeout ?? node.timeout, visualFallback: ctx.visualFallback });
}

function getVisualPoint(locator: unknown): { x: number; y: number } | null {
  return (locator as { __visualPoint?: { x: number; y: number } }).__visualPoint ?? null;
}

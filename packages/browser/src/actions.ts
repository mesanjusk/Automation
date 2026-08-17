import path from "node:path";
import type { NodeType, SelectorStrategy, WorkflowNode } from "@bos/shared";
import type { BrowserSession } from "./session";
import { resolveTarget, type VisualFallback } from "./selectorResolver";
import { interpolate, interpolateTarget, interpolateWithSecrets } from "./interpolate";

export interface BrowserActionContext {
  variables: Record<string, unknown>;
  downloadDir: string;
  visualFallback?: VisualFallback;
  /** Resolves {{secret:name}} tokens (credentials) just-in-time; never persisted to variables/logs. */
  resolveSecret?: (name: string) => Promise<string | undefined>;
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
      return { selectorStrategyUsed: strategy };
    }

    case "TYPE": {
      const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
      const value = await interpolateWithSecrets(cfg.value, ctx.variables, ctx.resolveSecret);
      await locator.fill(value, { timeout: node.timeout || 10_000 });
      return { selectorStrategyUsed: strategy };
    }

    case "CLEAR": {
      const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
      await locator.fill("");
      return { selectorStrategyUsed: strategy };
    }

    case "SELECT": {
      const { locator, strategy } = await resolveTargetOrThrow(page, node, ctx);
      const value = interpolate(cfg.value, ctx.variables);
      await locator.selectOption(value);
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
        return { selectorStrategyUsed: strategy };
      }
      await page.keyboard.press(cfg.key || "Enter");
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

    case "EXTRACT_TEXT": {
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

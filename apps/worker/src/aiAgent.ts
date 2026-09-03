import type { BrowserSession, VisualFallback } from "@bos/browser";
import { captureAgentSnapshot, describeChanges, type PageProbeReport } from "@bos/browser";
import {
  getDefaultLLMProvider,
  enforceAgentSafety,
  assertUrlAllowed,
  getMaxAgentActions,
  getGeminiTextModelName,
} from "@bos/ai";
import type { AgentAction, AgentActionOutcome, AgentContext } from "@bos/shared";
import { AIRequest } from "@bos/database";

/** Shape the engine writes to `browserAgentLastAction` after every action. */
interface LastActionRecord {
  tool?: string;
  status?: string;
  detail?: string;
  expectation?: string;
}

function tabsOf(session: BrowserSession): AgentContext["page"]["tabs"] {
  return session.tabs.map((page, index) => ({
    index,
    url: safeUrl(page),
    title: "",
    active: index === session.activeTabIndex,
  }));
}

function safeUrl(page: { url: () => string }): string {
  try {
    return page.url();
  } catch {
    return "(unavailable)";
  }
}

/**
 * Builds the decideNextAiAction hook consumed by the automation-engine for
 * AI_DECISION nodes.
 *
 * The loop is the one a browser extension runs: settle the page, snapshot it
 * with a ref on every control, tell the model what changed since its last
 * action, take exactly one structured tool call back, validate it against the
 * safety limits, and log the round trip for auditability. The diff is the part
 * that keeps it honest — without it a model cannot distinguish "my click
 * worked" from "my click hit a disabled button", and it will build several
 * more steps on top of an action that never happened.
 */
export function buildAiDecisionHook(taskId: string, session: BrowserSession, allowedDomains?: string[]) {
  let previousReport: PageProbeReport | undefined;

  return async (goal: string, variables: Record<string, unknown>, previousActions: AgentAction[]): Promise<AgentAction> => {
    const provider = getDefaultLLMProvider();
    const page = session.activePage;
    const snapshot = await captureAgentSnapshot(page, { tabs: tabsOf(session) });

    // A click on a link can leave the allowlist without any navigation tool
    // ever being called, so the boundary is re-checked on what the browser is
    // actually showing, not only on what the model asked for.
    assertUrlAllowed(snapshot.page.url, allowedDomains);

    const last = (variables.browserAgentLastAction ?? undefined) as LastActionRecord | undefined;
    const lastOutcome: AgentActionOutcome | undefined = last?.tool
      ? {
          tool: last.tool,
          status: last.status === "failed" ? "failed" : "success",
          detail: [last.detail, variables.browserAgentRepeatWarning].filter(Boolean).join(" ") || undefined,
          changed: describeChanges(previousReport, snapshot.report),
          expectation: last.expectation,
        }
      : undefined;

    const context: AgentContext = {
      goal,
      page: snapshot.page,
      variables,
      previousActions,
      lastError: variables.browserAgentLastError ? String(variables.browserAgentLastError) : undefined,
      lastOutcome,
      actionsSoFar: previousActions.length,
      maxActions: getMaxAgentActions(),
      allowedDomains,
    };

    const started = Date.now();
    try {
      const { action, rawResponse, tokensUsed } = await provider.decideNextAction(context);
      enforceAgentSafety(context, action);
      await AIRequest.create({
        taskId,
        provider: provider.name,
        modelName: provider.name === "gemini" ? getGeminiTextModelName() : provider.name,
        prompt: `goal=${goal} url=${snapshot.page.url} controls=${snapshot.report.elements.length}`,
        response: rawResponse,
        action,
        tokensUsed,
        latencyMs: Date.now() - started,
      });
      // Only once the decision is safe to run does this observation become the
      // baseline for the next diff; a rejected decision leaves the page
      // untouched, so the previous baseline is still the right one.
      previousReport = snapshot.report;
      return action;
    } catch (err) {
      await AIRequest.create({
        taskId,
        provider: provider.name,
        modelName: provider.name === "gemini" ? getGeminiTextModelName() : provider.name,
        prompt: `goal=${goal} url=${snapshot.page.url}`,
        error: (err as Error).message,
        latencyMs: Date.now() - started,
      });
      throw err;
    }
  };
}

/** Vision fallback used by the selector resolver when deterministic strategies fail. */
export function buildVisualFallback(): VisualFallback {
  return async (page, target) => {
    const provider = getDefaultLLMProvider();
    const instruction =
      target.elementDescription || target.text || target.ariaLabel || target.css || JSON.stringify(target);
    const screenshot = await page.screenshot({ fullPage: false });
    const result = await provider.locateElementInScreenshot(screenshot.toString("base64"), instruction);
    if (!result.found || !result.approxBoxPercent) return null;
    const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
    const { x, y, width, height } = result.approxBoxPercent;
    return {
      x: Math.round(((x + width / 2) / 100) * viewport.width),
      y: Math.round(((y + height / 2) / 100) * viewport.height),
    };
  };
}

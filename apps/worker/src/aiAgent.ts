import type { BrowserSession, VisualFallback } from "@bos/browser";
import { buildPageSnapshot } from "@bos/browser";
import { getDefaultLLMProvider, enforceAgentSafety, getMaxAgentActions, getGeminiTextModelName } from "@bos/ai";
import type { AgentAction, AgentContext } from "@bos/shared";
import { AIRequest } from "@bos/database";

/**
 * Builds the decideNextAiAction hook consumed by the automation-engine for
 * AI_DECISION nodes: snapshots the live page, asks Gemini for exactly one
 * structured tool call, validates it against the safety limits, and logs
 * the round-trip for auditability.
 */
export function buildAiDecisionHook(taskId: string, session: BrowserSession, allowedDomains?: string[]) {
  return async (goal: string, variables: Record<string, unknown>, previousActions: AgentAction[]): Promise<AgentAction> => {
    const provider = getDefaultLLMProvider();
    const page = session.activePage;
    const snapshot = await buildPageSnapshot(page);

    const context: AgentContext = {
      goal,
      page: snapshot,
      variables,
      previousActions,
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
        prompt: `goal=${goal} url=${snapshot.url}`,
        response: rawResponse,
        action,
        tokensUsed,
        latencyMs: Date.now() - started,
      });
      return action;
    } catch (err) {
      await AIRequest.create({
        taskId,
        provider: provider.name,
        modelName: provider.name === "gemini" ? getGeminiTextModelName() : provider.name,
        prompt: `goal=${goal} url=${snapshot.url}`,
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
    const instruction = target.text || target.ariaLabel || target.css || JSON.stringify(target);
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
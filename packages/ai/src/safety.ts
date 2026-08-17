import type { AgentAction, AgentContext } from "@bos/shared";

export class AgentSafetyViolation extends Error {}

const DEFAULT_MAX_ACTIONS = Number(process.env.MAX_AI_ACTIONS ?? 100);

export function getMaxAgentActions(): number {
  return DEFAULT_MAX_ACTIONS;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Enforced BEFORE an AI-selected action is handed to the browser executor.
 * This is the kill switch described in the platform's AI-safety requirements:
 * a runaway loop or an attempt to leave the allowed domain set is stopped
 * here, not by trusting the model to police itself.
 */
export function enforceAgentSafety(context: AgentContext, action: AgentAction): void {
  if (context.actionsSoFar >= context.maxActions) {
    throw new AgentSafetyViolation(
      `AI agent hit its action limit (${context.maxActions}). Stopping to prevent an infinite loop.`
    );
  }

  if (context.allowedDomains && context.allowedDomains.length > 0) {
    const candidateUrl = action.tool === "browser_navigate" ? action.url : undefined;
    if (candidateUrl) {
      const host = hostnameOf(candidateUrl);
      const allowed = host && context.allowedDomains.some((d) => host === d || host.endsWith(`.${d}`));
      if (!allowed) {
        throw new AgentSafetyViolation(
          `AI attempted to navigate to a domain outside the allowlist: ${candidateUrl}`
        );
      }
    }
  }
}

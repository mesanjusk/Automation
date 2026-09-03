import type { AgentAction, AgentContext, AgentTool } from "@bos/shared";

/**
 * A rejected agent action.
 *
 * `terminal` separates the two very different reasons this is thrown. A
 * malformed tool call is a model slip: re-prompting with the complaint usually
 * fixes it, so the run should carry on. Leaving the domain allowlist or
 * exhausting the action budget is a boundary being enforced — re-prompting
 * cannot make either acceptable, and retrying only burns the budget again.
 */
export class AgentSafetyViolation extends Error {
  readonly terminal: boolean;

  constructor(message: string, terminal = false) {
    super(message);
    this.name = "AgentSafetyViolation";
    this.terminal = terminal;
  }
}

const DEFAULT_MAX_ACTIONS = Number(process.env.MAX_AI_ACTIONS ?? 100);

export function getMaxAgentActions(): number {
  return DEFAULT_MAX_ACTIONS;
}

/** Tools that are meaningless without an element to act on. */
const REQUIRES_TARGET: AgentTool[] = [
  "browser_click",
  "browser_type",
  "browser_clear",
  "browser_select",
  "browser_hover",
  "browser_scroll_to",
  "browser_extract",
  "browser_upload",
];

/** Tools whose whole purpose is the value they carry. */
const REQUIRES_VALUE: AgentTool[] = ["browser_type", "browser_select", "browser_upload", "browser_wait_for"];

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isAllowedHost(url: string, allowedDomains: string[]): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Enforced BEFORE an AI-selected action is handed to the browser executor.
 * This is the kill switch described in the platform's AI-safety requirements:
 * a runaway loop or an attempt to leave the allowed domain set is stopped
 * here, not by trusting the model to police itself.
 *
 * It also rejects actions that are structurally incomplete — a click with no
 * element, a type with nothing to type. Those are model slips rather than
 * attacks, but catching them here turns a confusing failure deep inside the
 * selector resolver into one sentence the agent can act on next turn.
 */
export function enforceAgentSafety(context: AgentContext, action: AgentAction): void {
  if (context.actionsSoFar >= context.maxActions) {
    throw new AgentSafetyViolation(
      `AI agent hit its action limit (${context.maxActions}). Stopping to prevent an infinite loop.`,
      true
    );
  }

  if (REQUIRES_TARGET.includes(action.tool) && !action.target) {
    throw new AgentSafetyViolation(
      `"${action.tool}" needs a target element. Pick one from the current snapshot, e.g. {"ref":"e12"}.`
    );
  }

  if (REQUIRES_VALUE.includes(action.tool) && !action.value) {
    throw new AgentSafetyViolation(`"${action.tool}" needs a "value".`);
  }

  if (action.target && !action.target.ref && !hasAnyHint(action.target)) {
    throw new AgentSafetyViolation(
      `"${action.tool}" was given an empty target. Address the element by its snapshot ref, e.g. {"ref":"e12"}.`
    );
  }

  const allowedDomains = context.allowedDomains;
  if (allowedDomains && allowedDomains.length > 0) {
    // Both tools open a URL; the allowlist has to cover both or the second one
    // is a hole straight through it.
    const candidateUrl =
      action.tool === "browser_navigate" || action.tool === "browser_new_tab" ? action.url : undefined;
    if (candidateUrl && !isAllowedHost(candidateUrl, allowedDomains)) {
      throw new AgentSafetyViolation(
        `AI attempted to navigate to a domain outside the allowlist: ${candidateUrl}`,
        true
      );
    }
  }
}

/**
 * Checked AFTER an action, once the browser has settled: a click on a link or
 * a site-driven redirect moves the browser without ever calling a navigation
 * tool, so a pre-flight check alone cannot keep an agent inside its allowlist.
 */
export function assertUrlAllowed(url: string, allowedDomains?: string[]): void {
  if (!allowedDomains || allowedDomains.length === 0) return;
  if (url.startsWith("about:") || url.startsWith("chrome:")) return;
  if (!isAllowedHost(url, allowedDomains)) {
    throw new AgentSafetyViolation(
      `The browser ended up on ${url}, which is outside the allowed domains (${allowedDomains.join(", ")}).`,
      true
    );
  }
}

function hasAnyHint(target: NonNullable<AgentAction["target"]>): boolean {
  return Boolean(target.css || target.text || target.role || target.ariaLabel || target.testId || target.xpath);
}

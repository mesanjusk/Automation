import type { AgentAction, AgentContext, VisionTargetResult, WorkflowDefinition } from "@bos/shared";

/**
 * Abstraction over the underlying LLM so Gemini can be swapped for another
 * provider later without touching the automation-engine or worker.
 */
export interface LLMProvider {
  readonly name: string;

  /** Given the current browser/workflow context, decide the single next action. */
  decideNextAction(context: AgentContext): Promise<{ action: AgentAction; rawResponse: string; tokensUsed?: number }>;

  /** Vision fallback: locate an element on a screenshot when selectors fail. */
  locateElementInScreenshot(
    screenshotBase64: string,
    instruction: string
  ): Promise<VisionTargetResult>;

  /** Natural language -> draft workflow. Never executed automatically — UI must confirm. */
  generateWorkflowDraft(description: string): Promise<{ definition: WorkflowDefinition; rawResponse: string }>;
}

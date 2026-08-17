import type { BrowserSession, VisualFallback } from "@bos/browser";
import type { AgentAction, ExecutionStepStatus, NodeType, WorkflowDefinition, WorkflowNode } from "@bos/shared";

export interface StepStartEvent {
  stepId: string;
  nodeType: NodeType;
  nodeName: string;
  attempt: number;
}

export interface StepCompleteEvent {
  stepId: string;
  nodeType: NodeType;
  nodeName: string;
  status: ExecutionStepStatus;
  output?: unknown;
  error?: { message: string; category: string; retryable: boolean };
  duration: number;
  selectorStrategyUsed?: string;
  screenshotBuffer?: Buffer;
}

export interface HumanApprovalRequest {
  stepId: string;
  message: string;
  screenshotBuffer?: Buffer;
}

/**
 * Everything the engine needs from the outside world (persistence, AI,
 * webhooks) is injected here so the engine itself has zero dependency on
 * MongoDB/BullMQ — it only knows about browser sessions and these hooks.
 */
export interface EngineHooks {
  onStepStart?(event: StepStartEvent): Promise<void> | void;
  onStepComplete(event: StepCompleteEvent): Promise<void> | void;
  /** Called for AI_DECISION nodes. Must return a validated AgentAction. */
  decideNextAiAction?(goal: string, variables: Record<string, unknown>, previous: AgentAction[]): Promise<AgentAction>;
  /**
   * Called for HUMAN_APPROVAL nodes. Return "approved" / "rejected" if a
   * decision already exists, or "pending" to have the engine pause the whole
   * run (status WAITING_FOR_HUMAN) until a future resume() call.
   */
  requestHumanApproval(request: HumanApprovalRequest): Promise<"approved" | "rejected" | "pending">;
  deliverWebhook?(url: string, payload: Record<string, unknown>): Promise<void>;
  log?(message: string): void;
  /** Checked before every node. Return true to stop the run (task was cancelled from the dashboard/API). */
  shouldCancel?(): Promise<boolean> | boolean;
}

export interface EngineOptions {
  maxAiActions?: number;
  allowedAiDomains?: string[];
  visualFallback?: VisualFallback;
  resolveSecret?: (name: string) => Promise<string | undefined>;
}

export type EngineRunStatus = "completed" | "failed" | "paused" | "cancelled";

export interface EngineRunResult {
  status: EngineRunStatus;
  variables: Record<string, unknown>;
  lastNodeId?: string;
  pauseReason?: string;
  error?: { message: string; category: string; retryable: boolean; stepId?: string };
}

export interface EngineRunContext {
  definition: WorkflowDefinition;
  session: BrowserSession;
  hooks: EngineHooks;
  options: EngineOptions;
  downloadDir: string;
}

export function findNode(definition: WorkflowDefinition, id: string): WorkflowNode {
  const node = definition.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`Workflow references unknown node id "${id}"`);
  return node;
}

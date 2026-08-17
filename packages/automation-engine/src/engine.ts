import { executeBrowserAction, BROWSER_NODE_TYPES } from "@bos/browser";
import { AutomationError, type AgentAction, type WorkflowNode } from "@bos/shared";
import { evaluateCondition } from "./condition.js";
import { withRetry } from "./retry.js";
import { agentActionToWorkflowNode } from "./aiActionAdapter.js";
import { findNode, type EngineRunContext, type EngineRunResult } from "./types.js";

const BROWSER_NODE_TYPE_SET = new Set(BROWSER_NODE_TYPES);

interface RunState {
  variables: Record<string, unknown>;
  aiActionsSoFar: number;
  aiPreviousActions: AgentAction[];
}

export class WorkflowEngine {
  constructor(private ctx: EngineRunContext) {}

  async run(startNodeId: string, initialVariables: Record<string, unknown> = {}): Promise<EngineRunResult> {
    const state: RunState = {
      variables: { ...this.ctx.definition.variables, ...initialVariables },
      aiActionsSoFar: 0,
      aiPreviousActions: [],
    };

    let currentNodeId: string | null = startNodeId;

    while (currentNodeId) {
      if (await this.ctx.hooks.shouldCancel?.()) {
        return { status: "cancelled", variables: state.variables, lastNodeId: currentNodeId };
      }
      const node = findNode(this.ctx.definition, currentNodeId);
      let outcome: { next: string | null; end?: boolean; paused?: string };

      try {
        outcome = await this.executeNode(node, state);
      } catch (err) {
        const structured = err instanceof AutomationError ? err.toStructured() : undefined;
        await this.ctx.hooks.onStepComplete({
          stepId: node.id,
          nodeType: node.type,
          nodeName: node.name,
          status: "FAILED",
          duration: 0,
          error: {
            message: structured?.message ?? (err as Error).message,
            category: structured?.category ?? "PERMANENT",
            retryable: structured?.retryable ?? false,
          },
        });
        if (node.continueOnError) {
          currentNodeId = node.next ?? null;
          continue;
        }
        return {
          status: "failed",
          variables: state.variables,
          lastNodeId: node.id,
          error: {
            message: structured?.message ?? (err as Error).message,
            category: structured?.category ?? "PERMANENT",
            retryable: structured?.retryable ?? false,
            stepId: node.id,
          },
        };
      }

      if (outcome.paused) {
        return { status: "paused", variables: state.variables, lastNodeId: node.id, pauseReason: outcome.paused };
      }
      if (outcome.end) {
        return { status: node.type === "FAIL" ? "failed" : "completed", variables: state.variables, lastNodeId: node.id };
      }
      currentNodeId = outcome.next;
    }

    return { status: "completed", variables: state.variables };
  }

  private async executeNode(node: WorkflowNode, state: RunState): Promise<{ next: string | null; end?: boolean; paused?: string }> {
    const started = Date.now();
    await this.ctx.hooks.onStepStart?.({ stepId: node.id, nodeType: node.type, nodeName: node.name, attempt: 1 });

    if (BROWSER_NODE_TYPE_SET.has(node.type)) {
      const outcome = await withRetry(
        () =>
          executeBrowserAction(this.ctx.session, node, {
            variables: state.variables,
            downloadDir: this.ctx.downloadDir,
            visualFallback: this.ctx.options.visualFallback,
          }),
        node.retry,
        (attempt, err) => this.ctx.hooks.log?.(`Retry ${attempt} for step ${node.id}: ${(err as Error).message}`)
      );

      if (outcome.error) throw outcome.error;
      const result = outcome.result!;
      if (node.config.variableName && result.output !== undefined) {
        state.variables[node.config.variableName] = result.output;
      }
      await this.ctx.hooks.onStepComplete({
        stepId: node.id,
        nodeType: node.type,
        nodeName: node.name,
        status: "SUCCESS",
        output: result.output,
        duration: Date.now() - started,
        selectorStrategyUsed: result.selectorStrategyUsed,
        screenshotBuffer: result.screenshotBuffer,
      });
      return { next: node.next ?? null };
    }

    switch (node.type) {
      case "SET_VARIABLE": {
        if (node.config.variableName) state.variables[node.config.variableName] = node.config.variableValue;
        await this.complete(node, started, { [node.config.variableName ?? "?"]: node.config.variableValue });
        return { next: node.next ?? null };
      }

      case "GET_VARIABLE": {
        const value = node.config.variableName ? state.variables[node.config.variableName] : undefined;
        await this.complete(node, started, { value });
        return { next: node.next ?? null };
      }

      case "CONDITION": {
        const result = node.config.condition ? evaluateCondition(node.config.condition, state.variables) : false;
        await this.complete(node, started, { result });
        return { next: (result ? node.config.trueNodeId : node.config.falseNodeId) ?? node.next ?? null };
      }

      case "LOOP": {
        const count = node.config.loopCount ?? 0;
        if (node.config.bodyNodeId) {
          for (let i = 0; i < count; i++) {
            state.variables["loopIndex"] = i;
            await this.runChain(node.config.bodyNodeId, node.config.bodyEndNodeId as string | undefined, state);
          }
        }
        await this.complete(node, started, { iterations: count });
        return { next: node.next ?? null };
      }

      case "FOR_EACH": {
        const items = node.config.variableName ? state.variables[node.config.variableName] : undefined;
        const array = Array.isArray(items) ? items : [];
        if (node.config.bodyNodeId) {
          for (const item of array) {
            if (node.config.forEachVariable) state.variables[node.config.forEachVariable] = item;
            await this.runChain(node.config.bodyNodeId, node.config.bodyEndNodeId as string | undefined, state);
          }
        }
        await this.complete(node, started, { iterations: array.length });
        return { next: node.next ?? null };
      }

      case "AI_DECISION": {
        await this.runAiDecisionLoop(node, state);
        await this.complete(node, started, { actionsSoFar: state.aiActionsSoFar });
        return { next: node.next ?? null };
      }

      case "HUMAN_APPROVAL": {
        const decision = await this.ctx.hooks.requestHumanApproval({
          stepId: node.id,
          message: node.config.approvalMessage ?? "Human approval required to continue.",
        });
        if (decision === "pending") {
          await this.ctx.hooks.onStepComplete({
            stepId: node.id,
            nodeType: node.type,
            nodeName: node.name,
            status: "PENDING",
            duration: Date.now() - started,
          });
          return { next: null, paused: "HUMAN_APPROVAL" };
        }
        await this.complete(node, started, { decision });
        if (decision === "rejected") {
          return { next: (node.config.falseNodeId as string | undefined) ?? null, end: !node.config.falseNodeId };
        }
        return { next: node.next ?? null };
      }

      case "WEBHOOK": {
        if (node.config.webhookUrl) {
          await this.ctx.hooks.deliverWebhook?.(node.config.webhookUrl, {
            ...(node.config.webhookPayload ?? {}),
            variables: state.variables,
          });
        }
        await this.complete(node, started);
        return { next: node.next ?? null };
      }

      case "END": {
        await this.complete(node, started);
        return { next: null, end: true };
      }

      case "FAIL": {
        throw new AutomationError({
          errorCode: "WORKFLOW_FAIL_NODE",
          message: node.config.errorMessage ?? `Workflow explicitly failed at node "${node.id}"`,
          category: "PERMANENT",
          retryable: false,
          stepId: node.id,
        });
      }

      default:
        throw new Error(`Unhandled node type "${node.type}"`);
    }
  }

  private async complete(node: WorkflowNode, started: number, output?: unknown): Promise<void> {
    await this.ctx.hooks.onStepComplete({
      stepId: node.id,
      nodeType: node.type,
      nodeName: node.name,
      status: "SUCCESS",
      output,
      duration: Date.now() - started,
    });
  }

  /** Executes a body sub-chain (LOOP/FOR_EACH) starting at startId, following .next until endId (inclusive) or a dead end. */
  private async runChain(startId: string, endId: string | undefined, state: RunState): Promise<void> {
    let nodeId: string | null = startId;
    while (nodeId) {
      const node = findNode(this.ctx.definition, nodeId);
      const outcome = await this.executeNode(node, state);
      if (outcome.end || nodeId === endId) return;
      nodeId = outcome.next;
    }
  }

  private async runAiDecisionLoop(node: WorkflowNode, state: RunState): Promise<void> {
    const maxActions = this.ctx.options.maxAiActions ?? 100;
    const goal = node.config.prompt ?? node.name;

    for (;;) {
      if (state.aiActionsSoFar >= maxActions) {
        throw new AutomationError({
          errorCode: "AI_MAX_ACTIONS_EXCEEDED",
          message: `AI agent exceeded the maximum of ${maxActions} actions without completing the goal.`,
          category: "PERMANENT",
          retryable: false,
          stepId: node.id,
        });
      }
      if (!this.ctx.hooks.decideNextAiAction) {
        throw new Error("AI_DECISION node used but no decideNextAiAction hook was provided");
      }
      const action = await this.ctx.hooks.decideNextAiAction(goal, state.variables, state.aiPreviousActions);
      state.aiActionsSoFar += 1;
      state.aiPreviousActions.push(action);

      if (action.tool === "task_complete") return;
      if (action.tool === "task_fail") {
        throw new AutomationError({
          errorCode: "AI_TASK_FAIL",
          message: action.reason,
          category: "HUMAN_INTERVENTION_REQUIRED",
          retryable: false,
          stepId: node.id,
        });
      }

      const syntheticNode = agentActionToWorkflowNode(action, `${node.id}:ai:${state.aiActionsSoFar}`);
      const result = await executeBrowserAction(this.ctx.session, syntheticNode, {
        variables: state.variables,
        downloadDir: this.ctx.downloadDir,
        visualFallback: this.ctx.options.visualFallback,
      });
      if (action.resultVariable && result.output !== undefined) {
        state.variables[action.resultVariable] = result.output;
      }
      await this.ctx.hooks.onStepComplete({
        stepId: syntheticNode.id,
        nodeType: syntheticNode.type,
        nodeName: syntheticNode.name,
        status: "SUCCESS",
        output: result.output,
        duration: 0,
        selectorStrategyUsed: result.selectorStrategyUsed,
        screenshotBuffer: result.screenshotBuffer,
      });
    }
  }
}

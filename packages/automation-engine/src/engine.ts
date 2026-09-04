import { executeBrowserAction, interpolate, BROWSER_NODE_TYPES } from "@bos/browser";
import { AutomationError, parseLooseJson, type AgentAction, type WorkflowNode } from "@bos/shared";
import { evaluateCondition, resolveVariablePath } from "./condition";
import { withRetry } from "./retry";
import { actionSignature, agentActionToWorkflowNode, isTerminalTool } from "./aiActionAdapter";
import { findNode, type EngineRunContext, type EngineRunResult } from "./types";

const BROWSER_NODE_TYPE_SET = new Set(BROWSER_NODE_TYPES);

interface RunState {
  variables: Record<string, unknown>;
  aiActionsSoFar: number;
  aiPreviousActions: AgentAction[];
}

/** Identical consecutive agent actions tolerated before the run is stopped. */
const MAX_IDENTICAL_ACTIONS = 4;

/**
 * Recognised by shape rather than by class, so the engine keeps its
 * independence from the AI package (which is where the violation is raised).
 */
function isTerminalSafetyViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.name === "AgentSafetyViolation" &&
    (err as Error & { terminal?: boolean }).terminal === true
  );
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
            resolveSecret: this.ctx.options.resolveSecret,
            emitScreenshot: this.ctx.hooks.onScreenshot?.bind(this.ctx.hooks),
            log: this.ctx.hooks.log?.bind(this.ctx.hooks),
          }),
        node.retry,
        (attempt, err) => this.ctx.hooks.log?.(`Retry ${attempt} for step ${node.id}: ${(err as Error).message}`)
      );

      if (outcome.error) throw outcome.error;
      const result = outcome.result!;
      const variableName = node.config?.variableName;
      if (variableName && result.output !== undefined) {
        state.variables[variableName] = result.output;
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

      case "PARSE_JSON": {
        // Parsing a model's reply belongs here, in code that can be tested,
        // rather than inside a page script where a stray quote takes the whole
        // run down with it. The lenient parser repairs what it safely can and
        // reports precisely what it could not, so a workflow can branch on the
        // failure and ask for a better answer instead of dying.
        const source = node.config.sourceVariable
          ? resolveVariablePath(node.config.sourceVariable, state.variables)
          : undefined;
        const target = node.config.variableName ?? "parsed";
        const text = typeof source === "string" ? source : source === undefined ? "" : JSON.stringify(source);
        const result = parseLooseJson(text);

        if (!result.ok) {
          delete state.variables[target];
          const detail = result.truncated
            ? "The reply stopped mid-value, so it was almost certainly read before it had finished being written."
            : result.error;
          state.variables[`${target}Error`] = `${detail} Around the failure: ${result.excerpt}`;
          throw new AutomationError({
            errorCode: result.truncated ? "JSON_REPLY_TRUNCATED" : "JSON_PARSE_FAILED",
            message:
              `Could not parse ${node.config.sourceVariable ?? "the input"} as JSON: ${detail} ` +
              `Around the failure: ${result.excerpt}`,
            // Re-reading or re-asking genuinely can succeed, so this must not
            // be filed as PERMANENT and strand a run that is one retry from
            // working.
            category: "TRANSIENT",
            retryable: true,
            stepId: node.id,
          });
        }

        const missing = (node.config.require ?? []).filter((path) => {
          const value = resolveVariablePath(path, result.value as Record<string, unknown>);
          return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
        });
        if (missing.length > 0) {
          delete state.variables[target];
          state.variables[`${target}Error`] = `The JSON parsed but is missing: ${missing.join(", ")}.`;
          throw new AutomationError({
            errorCode: "JSON_MISSING_FIELDS",
            message: `The parsed JSON is missing required field(s): ${missing.join(", ")}.`,
            category: "TRANSIENT",
            retryable: true,
            stepId: node.id,
          });
        }

        state.variables[target] = result.value;
        delete state.variables[`${target}Error`];
        if (result.repairs.length > 0) {
          this.ctx.hooks.log?.(`Parsed ${target} after repairing the reply: ${result.repairs.join("; ")}.`);
        }
        await this.complete(node, started, { repairs: result.repairs, requiredPresent: node.config.require ?? [] });
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
        const items = node.config.variableName
          ? resolveVariablePath(node.config.variableName, state.variables)
          : undefined;
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
        await this.complete(node, started, { actionsSoFar: state.aiActionsSoFar, result: state.variables.browserAgentResult });
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
          errorCode: node.config.errorCode ?? "WORKFLOW_FAIL_NODE",
          // Interpolated, so a FAIL node can report the diagnostic the step
          // that actually failed left behind instead of a fixed sentence that
          // says nothing about this run.
          message: node.config.errorMessage
            ? interpolate(node.config.errorMessage, state.variables)
            : `Workflow explicitly failed at node "${node.id}"`,
          category: node.config.category ?? "PERMANENT",
          retryable: node.config.retryable ?? false,
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
    let consecutiveActionFailures = 0;
    // An agent that cannot tell its click did nothing will happily click the
    // same dead control until its whole budget is gone. Identical consecutive
    // actions are the observable signature of that, so they are counted and
    // eventually stopped with an error that names the action it was stuck on.
    let lastSignature = "";
    let repeatCount = 0;

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

      let action: AgentAction;
      try {
        action = await this.ctx.hooks.decideNextAiAction(goal, state.variables, state.aiPreviousActions);
      } catch (err) {
        // A boundary the agent is not allowed to cross (the domain allowlist,
        // the action budget) is not a hiccup to re-observe past: re-asking
        // cannot make it acceptable, and retrying only spends the budget again.
        if (isTerminalSafetyViolation(err)) {
          throw new AutomationError({
            errorCode: "AI_SAFETY_VIOLATION",
            message: (err as Error).message,
            category: "PERMANENT",
            retryable: false,
            stepId: node.id,
          });
        }
        // Otherwise: getting a decision can fail for reasons that have nothing
        // to do with the mission — the model's tab closed, it replied with
        // prose. That is worth one observation, not the whole run, so it draws
        // on the same budget a failed browser action does and the loop
        // re-observes. Without this the raw error escapes unclassified and the
        // engine files it as PERMANENT, ending a long mission on one hiccup.
        consecutiveActionFailures += 1;
        const message = (err as Error).message;
        state.variables.browserAgentLastError = `Could not obtain the next decision: ${message}`;
        state.variables.browserAgentLastAction = { tool: "(decision)", status: "failed", detail: message };
        this.ctx.hooks.log?.(`Adaptive browser decision failed (${consecutiveActionFailures}/5): ${message}. Re-observing.`);
        await this.ctx.hooks.onStepComplete({
          stepId: `${node.id}:decision:${state.aiActionsSoFar + consecutiveActionFailures}`,
          nodeType: node.type,
          nodeName: `${node.name} — decision`,
          status: "FAILED",
          duration: 0,
          error: { message, category: "TRANSIENT", retryable: true },
        });
        if (consecutiveActionFailures >= 5) {
          throw new AutomationError({
            errorCode: "BROWSER_AGENT_BRAIN_UNAVAILABLE",
            message: `Adaptive browser agent could not get a decision after ${consecutiveActionFailures} attempts. Last error: ${message}`,
            category: "TRANSIENT",
            retryable: true,
            stepId: node.id,
          });
        }
        continue;
      }
      state.aiActionsSoFar += 1;
      state.aiPreviousActions.push(action);

      const signature = actionSignature(action);
      if (signature === lastSignature && !isTerminalTool(action.tool)) {
        repeatCount += 1;
        if (repeatCount >= MAX_IDENTICAL_ACTIONS) {
          throw new AutomationError({
            errorCode: "AI_REPEATED_ACTION_LOOP",
            message:
              `AI agent repeated the same action ${repeatCount + 1} times without making progress: ` +
              `${action.tool} (${action.reason}). The page is not responding to it.`,
            category: "WEBSITE_CHANGED",
            retryable: false,
            stepId: node.id,
          });
        }
        state.variables.browserAgentRepeatWarning =
          `You have now issued this identical action ${repeatCount + 1} times and the page has not responded. ` +
          `Stop repeating it — observe the page again and choose a different approach.`;
      } else {
        repeatCount = 0;
        lastSignature = signature;
        delete state.variables.browserAgentRepeatWarning;
      }

      if (action.tool === "task_complete") {
        state.variables.browserAgentResult = { status: "completed", reason: action.reason, actions: state.aiActionsSoFar };
        delete state.variables.browserAgentLastError;
        delete state.variables.browserAgentLastAction;
        delete state.variables.browserAgentRepeatWarning;
        return;
      }
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
      try {
        const result = await executeBrowserAction(this.ctx.session, syntheticNode, {
          variables: state.variables,
          downloadDir: this.ctx.downloadDir,
          visualFallback: this.ctx.options.visualFallback,
          resolveSecret: this.ctx.options.resolveSecret,
          emitScreenshot: this.ctx.hooks.onScreenshot?.bind(this.ctx.hooks),
          log: this.ctx.hooks.log?.bind(this.ctx.hooks),
        });
        consecutiveActionFailures = 0;
        delete state.variables.browserAgentLastError;
        // The next observation is taken by the decision hook, which needs to
        // know what the agent just did in order to report what changed.
        state.variables.browserAgentLastAction = {
          tool: action.tool,
          status: "success",
          expectation: action.expectation,
        };
        if (action.resultVariable && result.output !== undefined) {
          state.variables[action.resultVariable] = result.output;
        }
        if (result.downloadedFilePath) {
          state.variables.browserAgentLastDownload = result.downloadedFilePath;
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
      } catch (err) {
        consecutiveActionFailures += 1;
        const message = (err as Error).message;
        state.variables.browserAgentLastError = message;
        state.variables.browserAgentLastAction = {
          tool: action.tool,
          status: "failed",
          detail: message,
          expectation: action.expectation,
        };
        this.ctx.hooks.log?.(`Adaptive browser action failed (${consecutiveActionFailures}/5): ${message}. Re-observing and replanning.`);
        await this.ctx.hooks.onStepComplete({
          stepId: syntheticNode.id,
          nodeType: syntheticNode.type,
          nodeName: syntheticNode.name,
          status: "FAILED",
          duration: 0,
          error: { message, category: "TRANSIENT", retryable: true },
        });
        if (consecutiveActionFailures >= 5) {
          throw new AutomationError({
            errorCode: "BROWSER_AGENT_STALLED",
            message: `Adaptive browser agent had ${consecutiveActionFailures} consecutive browser-action failures. Last error: ${message}`,
            category: "WEBSITE_CHANGED",
            retryable: false,
            stepId: node.id,
          });
        }
        // Do not fail the mission because one element went stale. The next
        // decision gets a fresh live observation plus browserAgentLastError.
        continue;
      }
    }
  }
}

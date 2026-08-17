import { AutomationError, isTransient, type RetryPolicy } from "@bos/shared";

export interface RetryOutcome<T> {
  result?: T;
  attempts: number;
  error?: unknown;
}

function delayFor(policy: RetryPolicy, attempt: number): number {
  if (!policy.exponentialBackoff) return Math.min(policy.delayMs, policy.maxDelayMs);
  const delay = policy.delayMs * 2 ** (attempt - 1);
  return Math.min(delay, policy.maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs fn with the node's retry policy. Only TRANSIENT (or unclassified,
 * heuristically-transient) failures are retried — permanent, auth, and
 * human-intervention failures fail fast so they surface to the operator
 * instead of burning through retries pointlessly.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  onRetry?: (attempt: number, error: unknown) => void
): Promise<RetryOutcome<T>> {
  let lastError: unknown;
  const totalAttempts = policy.maxRetries + 1;
  let attemptsMade = 0;
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    attemptsMade = attempt;
    try {
      const result = await fn(attempt);
      return { result, attempts: attempt };
    } catch (err) {
      lastError = err;
      const retryable = err instanceof AutomationError ? err.retryable : isTransient(err);
      if (!retryable || attempt === totalAttempts) break;
      onRetry?.(attempt, err);
      await sleep(delayFor(policy, attempt));
    }
  }
  return { attempts: attemptsMade, error: lastError };
}

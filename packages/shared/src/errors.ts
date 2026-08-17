import type { FailureCategory } from "./enums";

export interface StructuredError {
  errorCode: string;
  message: string;
  stepId?: string;
  category: FailureCategory;
  retryable: boolean;
  timestamp: string;
  details?: Record<string, unknown>;
}

export class AutomationError extends Error {
  errorCode: string;
  category: FailureCategory;
  retryable: boolean;
  stepId?: string;
  details?: Record<string, unknown>;

  constructor(params: {
    errorCode: string;
    message: string;
    category: FailureCategory;
    retryable: boolean;
    stepId?: string;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "AutomationError";
    this.errorCode = params.errorCode;
    this.category = params.category;
    this.retryable = params.retryable;
    this.stepId = params.stepId;
    this.details = params.details;
  }

  toStructured(): StructuredError {
    return {
      errorCode: this.errorCode,
      message: this.message,
      stepId: this.stepId,
      category: this.category,
      retryable: this.retryable,
      timestamp: new Date().toISOString(),
      details: this.details,
    };
  }
}

export function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("net::") ||
    msg.includes("econnreset") ||
    msg.includes("navigation") ||
    msg.includes("detached") ||
    msg.includes("crashed")
  );
}

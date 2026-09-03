import type { Page } from "playwright";
import type { AgentPageSnapshot } from "@bos/shared";
import { captureAgentSnapshot, type AgentSnapshotOptions } from "./agentSnapshot";

/**
 * Builds the context the AI agent reasons over.
 *
 * Deliberately excludes raw HTML/full DOM: it keeps prompts small, it avoids
 * ever putting a password field's value in front of a model, and — the part
 * that matters for accuracy — it means the agent reasons about *controls it can
 * address*, each carrying the ref it will act with, rather than about markup it
 * has to translate into a selector by guesswork.
 */
export async function buildPageSnapshot(
  page: Page,
  opts: AgentSnapshotOptions = {}
): Promise<Omit<AgentPageSnapshot, "screenshotFileId">> {
  const snapshot = await captureAgentSnapshot(page, opts);
  return snapshot.page;
}

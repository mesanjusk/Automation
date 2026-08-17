export * from "./provider";
export * from "./gemini";
export * from "./safety";
export * from "./promptBuilder";

import type { LLMProvider } from "./provider";
import { GeminiProvider } from "./gemini";

let cachedProvider: LLMProvider | null = null;

/** Default provider factory. Swap this out (or construct a provider directly) to use a different LLM. */
export function getDefaultLLMProvider(): LLMProvider {
  if (!cachedProvider) cachedProvider = new GeminiProvider();
  return cachedProvider;
}

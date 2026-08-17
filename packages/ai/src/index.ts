export * from "./provider.js";
export * from "./gemini.js";
export * from "./safety.js";
export * from "./promptBuilder.js";

import type { LLMProvider } from "./provider.js";
import { GeminiProvider } from "./gemini.js";

let cachedProvider: LLMProvider | null = null;

/** Default provider factory. Swap this out (or construct a provider directly) to use a different LLM. */
export function getDefaultLLMProvider(): LLMProvider {
  if (!cachedProvider) cachedProvider = new GeminiProvider();
  return cachedProvider;
}

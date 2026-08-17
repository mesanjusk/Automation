/** Replaces {{variableName}} tokens in a string with values from the variable bag. */
export function interpolate(template: string | undefined, variables: Record<string, unknown>): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, variables);
    return value === undefined || value === null ? "" : String(value);
  });
}

/**
 * Like interpolate(), but also resolves {{secret:credentialName}} tokens
 * through an injected async resolver instead of the plain variable bag.
 * Secrets resolved this way are substituted directly into the outgoing
 * Playwright action and are NEVER written back into `variables` — so they
 * never reach an AI prompt, an execution log, or a screenshot caption.
 */
export async function interpolateWithSecrets(
  template: string | undefined,
  variables: Record<string, unknown>,
  resolveSecret?: (name: string) => Promise<string | undefined>
): Promise<string> {
  if (!template) return "";
  const secretPattern = /\{\{\s*secret:([\w.-]+)\s*\}\}/g;
  if (!resolveSecret || !secretPattern.test(template)) {
    return interpolate(template, variables);
  }
  secretPattern.lastIndex = 0;
  let result = template;
  const matches = [...template.matchAll(secretPattern)];
  for (const match of matches) {
    const captured = match[1];
    if (!captured) continue;
    const value = (await resolveSecret(captured)) ?? "";
    result = result.replace(match[0], value);
  }
  return interpolate(result, variables);
}

export function interpolateTarget<T extends Record<string, unknown>>(
  target: T,
  variables: Record<string, unknown>
): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target)) {
    out[key] = typeof value === "string" ? interpolate(value, variables) : value;
  }
  return out as T;
}

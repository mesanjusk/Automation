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

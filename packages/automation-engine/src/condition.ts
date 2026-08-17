import type { ConditionExpression } from "@bos/shared";

function resolveVar(path: string, variables: Record<string, unknown>): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, variables);
}

export function evaluateCondition(expr: ConditionExpression, variables: Record<string, unknown>): boolean {
  const left = resolveVar(expr.left, variables);
  const right = expr.right;

  switch (expr.operator) {
    case "equals":
      return left === right;
    case "notEquals":
      return left !== right;
    case "contains":
      return typeof left === "string" && typeof right === "string" ? left.includes(right) : Array.isArray(left) ? left.includes(right) : false;
    case "notContains":
      return !(typeof left === "string" && typeof right === "string" ? left.includes(right) : Array.isArray(left) ? left.includes(right) : false);
    case "greaterThan":
      return Number(left) > Number(right);
    case "lessThan":
      return Number(left) < Number(right);
    case "exists":
      return left !== undefined && left !== null;
    case "notExists":
      return left === undefined || left === null;
    case "isTrue":
      return left === true || left === "true";
    case "isFalse":
      return left === false || left === "false";
    default:
      return false;
  }
}

/**
 * Pure validation helpers used by the policy engine.
 *
 * Each returns null on success or a human-readable failure reason. Keeping
 * these pure and side-effect free makes the policy engine easy to reason about
 * and test.
 */

import type { ValidationRule } from "../types.js";

/** Resolve a (possibly nested) argument value by dotted path, e.g. "config.path". */
export function resolveArg(
  args: Record<string, unknown>,
  path: string
): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as object)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, args);
}

/** Collect every string value anywhere in the args (used by wildcard "*" rules). */
export function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStringValues);
  }
  return [];
}

/**
 * Check a single value against a validation constraint.
 * Returns null if it passes, or a reason string if it fails.
 */
export function checkConstraint(
  value: unknown,
  constraint: ValidationRule["constraint"]
): string | null {
  // A missing argument cannot satisfy a positive constraint (prefix/regex).
  // For safety we treat "argument absent" as a failure for prefix/regex/maxLength,
  // but as a pass for denyContains (nothing to deny).
  const str = value === undefined || value === null ? undefined : String(value);

  switch (constraint.kind) {
    case "prefix": {
      if (str === undefined) return `value is missing but must start with "${constraint.value}"`;
      return str.startsWith(constraint.value)
        ? null
        : `value "${str}" must start with "${constraint.value}"`;
    }
    case "regex": {
      if (str === undefined) return `value is missing but must match /${constraint.value}/`;
      let re: RegExp;
      try {
        re = new RegExp(constraint.value);
      } catch {
        // A malformed regex rule should fail closed rather than silently allow.
        return `validation rule has an invalid regex: /${constraint.value}/`;
      }
      return re.test(str) ? null : `value "${str}" must match /${constraint.value}/`;
    }
    case "denyContains": {
      if (str === undefined) return null;
      // The value may list several forbidden phrases separated by "|".
      const lower = str.toLowerCase();
      const phrases = constraint.value.split("|").map((p) => p.trim()).filter(Boolean);
      const hit = phrases.find((p) => lower.includes(p.toLowerCase()));
      return hit ? `value must not contain "${hit}"` : null;
    }
    case "maxLength": {
      const max = Number(constraint.value);
      if (Number.isNaN(max)) return `validation rule has an invalid maxLength: "${constraint.value}"`;
      if (str === undefined) return null;
      return str.length > max
        ? `value length ${str.length} exceeds maximum of ${max}`
        : null;
    }
    default:
      // Unknown constraint kind: fail closed.
      return `unknown validation constraint kind`;
  }
}

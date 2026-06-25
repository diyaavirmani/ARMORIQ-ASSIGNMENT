/**
 * PolicyEngine — the heart of the system.
 *
 * This module is deliberately self-contained: it has no knowledge of OpenAI,
 * MCP, Express, or sockets. It is a pure decision function. Given a tool call
 * in context, it answers a single question: ALLOW, BLOCK, or REQUIRE_APPROVAL.
 *
 * The agent loop is required to call `evaluate()` before every tool execution
 * and obey the result. Because enforcement lives here — outside the model —
 * no prompt-injection or clever phrasing in the conversation can change what
 * is permitted. The model can *ask*; only the engine decides.
 *
 * Design choices that matter:
 *  - Rules are read FRESH on every evaluation (via the injected getRules fn),
 *    so dashboard edits take effect on the next tool call with no restart.
 *  - Conflicts resolve deterministically by "most restrictive wins":
 *      BLOCK  >  REQUIRE_APPROVAL  >  ALLOW
 *    Budget overruns and failed validations are themselves BLOCKs, so they sit
 *    at the top of that precedence automatically.
 *  - Every decision carries the rule that caused it, for auditable logs.
 */

import type {
  PolicyContext,
  PolicyDecision,
  Rule,
} from "../types.js";
import { checkConstraint, collectStringValues, resolveArg } from "./validators.js";

/** Does a rule's `tool` selector match this tool? Supports "*", bare, and qualified names. */
function toolMatches(ruleTool: string, ctx: PolicyContext): boolean {
  if (ruleTool === "*") return true;
  return ruleTool === ctx.tool.name || ruleTool === ctx.tool.qualifiedName;
}

export class PolicyEngine {
  /**
   * @param getRules a function returning the CURRENT rule set. Injected (rather
   * than a stored array) so the engine always sees the latest dashboard state.
   */
  constructor(private readonly getRules: () => Rule[]) {}

  /**
   * Standalone budget check, independent of any specific tool. The agent loop
   * calls this before each model turn so an over-budget conversation stops
   * spending tokens entirely — not just stops calling tools. Keeping the budget
   * logic here means the engine remains the single authority on limits.
   */
  checkBudget(tokensSpent: number): PolicyDecision {
    for (const rule of this.getRules().filter((r) => r.enabled)) {
      if (rule.type === "budget" && tokensSpent >= rule.maxTokens) {
        return {
          effect: "block",
          ruleId: rule.id,
          ruleName: rule.name,
          reason: `Conversation token budget exceeded (${tokensSpent} >= ${rule.maxTokens}).`,
        };
      }
    }
    return { effect: "allow", reason: "Within budget." };
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    const rules = this.getRules().filter((r) => r.enabled);

    // --- 1. Budget (a BLOCK if the conversation is already over its cap) -----
    // Evaluated first because it is independent of the specific tool and is the
    // hardest stop: an over-budget conversation may run no tools at all.
    for (const rule of rules) {
      if (rule.type === "budget" && ctx.tokensSpent >= rule.maxTokens) {
        return {
          effect: "block",
          ruleId: rule.id,
          ruleName: rule.name,
          reason: `Conversation token budget exceeded (${ctx.tokensSpent} >= ${rule.maxTokens}). No further tools may run.`,
        };
      }
    }

    // --- 2. Explicit block rules --------------------------------------------
    for (const rule of rules) {
      if (rule.type === "block" && toolMatches(rule.tool, ctx)) {
        return {
          effect: "block",
          ruleId: rule.id,
          ruleName: rule.name,
          reason: `Tool "${ctx.tool.name}" is blocked by policy "${rule.name}".`,
        };
      }
    }

    // --- 3. Input validation (a failed validation is also a BLOCK) ----------
    for (const rule of rules) {
      if (rule.type === "validation" && toolMatches(rule.tool, ctx)) {
        // argument "*" scans EVERY argument value — used by the injection
        // guardrail to catch a forbidden phrase wherever it appears.
        if (rule.argument === "*") {
          for (const v of collectStringValues(ctx.args)) {
            const failure = checkConstraint(v, rule.constraint);
            if (failure) {
              return {
                effect: "block",
                ruleId: rule.id,
                ruleName: rule.name,
                reason: `Input validation failed for "${ctx.tool.name}": ${failure}.`,
              };
            }
          }
          continue;
        }
        const value = resolveArg(ctx.args, rule.argument);
        // A validation rule constrains a specific argument. If this call does
        // not include that argument, the rule simply doesn't apply (e.g. a
        // "path must be under /sandbox/" rule is irrelevant to list_servers).
        // The tool's own schema still enforces required args.
        if (value === undefined || value === null) continue;
        const failure = checkConstraint(value, rule.constraint);
        if (failure) {
          return {
            effect: "block",
            ruleId: rule.id,
            ruleName: rule.name,
            reason: `Input validation failed for "${ctx.tool.name}" (argument "${rule.argument}"): ${failure}.`,
          };
        }
      }
    }

    // --- 4. Approval rules (only reached if nothing above blocked) ----------
    for (const rule of rules) {
      if (rule.type === "approval" && toolMatches(rule.tool, ctx)) {
        return {
          effect: "require_approval",
          ruleId: rule.id,
          ruleName: rule.name,
          reason: `Tool "${ctx.tool.name}" requires human approval per policy "${rule.name}".`,
        };
      }
    }

    // --- 5. Default allow ----------------------------------------------------
    return {
      effect: "allow",
      reason: "No policy restricts this tool call.",
    };
  }
}

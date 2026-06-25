/**
 * Shared domain types for the guarded agent.
 *
 * These are the contracts that the agent loop, the policy engine, the MCP
 * transport, and the dashboard all agree on. Keeping them in one place makes
 * the seam between "what the model wants" and "what is permitted" explicit.
 */

// ---------------------------------------------------------------------------
// Tools (discovered live from MCP servers — never hardcoded)
// ---------------------------------------------------------------------------

export interface ToolDescriptor {
  /** Stable id of the MCP server this tool came from (from servers.json). */
  serverId: string;
  /** Human-friendly server label for the UI. */
  serverLabel: string;
  /** The tool name as exposed by the MCP server, e.g. "delete_database". */
  name: string;
  /**
   * Collision-safe name presented to the LLM, e.g. "ops_console__delete_database".
   * The agent maps this back to (serverId, name) when executing.
   */
  qualifiedName: string;
  description: string;
  /** JSON Schema for the tool arguments, straight from the MCP server. */
  inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Policy rules (created/toggled live from the dashboard)
// ---------------------------------------------------------------------------

export type RuleType = "block" | "approval" | "validation" | "budget";

interface BaseRule {
  id: string;
  type: RuleType;
  /** Human label shown in the dashboard and logs. */
  name: string;
  enabled: boolean;
  createdAt: string;
}

/** Block a tool entirely. `tool` may be a bare name, a qualified name, or "*". */
export interface BlockRule extends BaseRule {
  type: "block";
  tool: string;
}

/** Require human approval before a tool runs. */
export interface ApprovalRule extends BaseRule {
  type: "approval";
  tool: string;
}

/**
 * Validate a tool argument. If the constraint fails, the call is blocked.
 * Example: tool="*", argument="path", kind="prefix", value="/sandbox/".
 */
export interface ValidationRule extends BaseRule {
  type: "validation";
  tool: string;
  /** Name of the argument to inspect. */
  argument: string;
  constraint: {
    kind: "prefix" | "regex" | "denyContains" | "maxLength";
    value: string;
  };
}

/** Cap the total token spend of a single conversation. */
export interface BudgetRule extends BaseRule {
  type: "budget";
  maxTokens: number;
}

export type Rule = BlockRule | ApprovalRule | ValidationRule | BudgetRule;

// ---------------------------------------------------------------------------
// Policy decisions
// ---------------------------------------------------------------------------

export type Effect = "allow" | "block" | "require_approval";

export interface PolicyDecision {
  effect: Effect;
  /** The rule that determined the outcome (undefined for a default allow). */
  ruleId?: string;
  ruleName?: string;
  /** Human-readable explanation, surfaced to the LLM and the logs. */
  reason: string;
}

/** Everything the policy engine needs to know to make a decision. */
export interface PolicyContext {
  conversationId: string;
  tool: ToolDescriptor;
  args: Record<string, unknown>;
  /** Tokens already spent in this conversation, for budget enforcement. */
  tokensSpent: number;
}

// ---------------------------------------------------------------------------
// Human-in-the-loop approvals
// ---------------------------------------------------------------------------

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalRequest {
  id: string;
  conversationId: string;
  toolName: string;
  qualifiedName: string;
  args: Record<string, unknown>;
  ruleName: string;
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
}

// ---------------------------------------------------------------------------
// Conversation logs
// ---------------------------------------------------------------------------

export type LogType =
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "policy_decision"
  | "approval"
  | "error"
  | "system";

export interface LogEntry {
  id: string;
  conversationId: string;
  timestamp: string;
  type: LogType;
  message: string;
  /** Arbitrary structured detail for the UI (args, decision, etc). */
  detail?: Record<string, unknown>;
}

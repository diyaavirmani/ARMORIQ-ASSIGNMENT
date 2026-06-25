// Mirror of the agent's domain types (the slice the dashboard needs).

export type RuleType = "block" | "approval" | "validation" | "budget";

export interface Rule {
  id: string;
  type: RuleType;
  name: string;
  enabled: boolean;
  createdAt: string;
  tool?: string;
  argument?: string;
  constraint?: { kind: string; value: string };
  maxTokens?: number;
}

export interface ToolDescriptor {
  serverId: string;
  serverLabel: string;
  name: string;
  qualifiedName: string;
  description: string;
}

export interface ServerHealth {
  id: string;
  label: string;
  transport: string;
  status: "connected" | "error" | "disabled";
  toolCount: number;
  error?: string;
}

export interface LogEntry {
  id: string;
  conversationId: string;
  timestamp: string;
  type: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface ApprovalRequest {
  id: string;
  conversationId: string;
  toolName: string;
  qualifiedName: string;
  args: Record<string, unknown>;
  ruleName: string;
  reason: string;
  status: string;
  createdAt: string;
}

/**
 * ApprovalManager — human-in-the-loop gate.
 *
 * When the policy engine returns REQUIRE_APPROVAL, the agent loop pauses and
 * asks this manager to obtain a decision. The manager records a pending request,
 * emits an event (so the API can push it to the dashboard), and returns a
 * Promise that resolves when an admin approves/denies — or when the request
 * times out.
 *
 * Edge case "approver is offline": approvals FAIL CLOSED. If no human responds
 * within `timeoutMs`, the request auto-expires and the tool call is denied.
 * Safety is the default; a missing approver never results in a dangerous tool
 * running by accident.
 */

import { EventEmitter } from "node:events";
import { v4 as uuid } from "uuid";
import type { ApprovalRequest } from "../types.js";

interface Pending {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

export class ApprovalManager extends EventEmitter {
  private pending = new Map<string, Pending>();

  constructor(private readonly timeoutMs = 60_000) {
    super();
  }

  /**
   * Create an approval request and wait for a human decision.
   * Resolves true (approved) or false (denied/expired).
   */
  request(input: {
    conversationId: string;
    toolName: string;
    qualifiedName: string;
    args: Record<string, unknown>;
    ruleName: string;
    reason: string;
  }): Promise<boolean> {
    const request: ApprovalRequest = {
      id: uuid(),
      conversationId: input.conversationId,
      toolName: input.toolName,
      qualifiedName: input.qualifiedName,
      args: input.args,
      ruleName: input.ruleName,
      reason: input.reason,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        // Fail closed: no response in time => deny.
        const p = this.pending.get(request.id);
        if (!p) return;
        this.pending.delete(request.id);
        p.request.status = "expired";
        p.request.resolvedAt = new Date().toISOString();
        this.emit("resolved", p.request);
        resolve(false);
      }, this.timeoutMs);

      this.pending.set(request.id, { request, resolve, timer });
      this.emit("created", request);
    });
  }

  /** Called by the API when an admin clicks approve/deny. */
  resolve(id: string, approved: boolean): ApprovalRequest | undefined {
    const p = this.pending.get(id);
    if (!p) return undefined;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.request.status = approved ? "approved" : "denied";
    p.request.resolvedAt = new Date().toISOString();
    this.emit("resolved", p.request);
    p.resolve(approved);
    return p.request;
  }

  listPending(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }
}

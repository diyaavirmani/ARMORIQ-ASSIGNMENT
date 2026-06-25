/**
 * LogStore — append-only conversation log.
 *
 * Every meaningful event (user message, model reply, tool call, policy
 * decision, approval, error) is appended here and emitted so the dashboard can
 * stream it live. This is the audit trail: it shows what the agent did, which
 * tools it called, and what the policy engine blocked.
 */

import { EventEmitter } from "node:events";
import { v4 as uuid } from "uuid";
import type { LogEntry, LogType } from "../types.js";

export class LogStore extends EventEmitter {
  private entries: LogEntry[] = [];

  constructor(private readonly maxEntries = 2000) {
    super();
  }

  append(
    conversationId: string,
    type: LogType,
    message: string,
    detail?: Record<string, unknown>
  ): LogEntry {
    const entry: LogEntry = {
      id: uuid(),
      conversationId,
      timestamp: new Date().toISOString(),
      type,
      message,
      detail,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    this.emit("append", entry);
    return entry;
  }

  all(): LogEntry[] {
    return [...this.entries];
  }

  byConversation(conversationId: string): LogEntry[] {
    return this.entries.filter((e) => e.conversationId === conversationId);
  }
}

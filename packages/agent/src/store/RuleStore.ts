/**
 * RuleStore — the single source of truth for guardrail rules.
 *
 * Persists rules to a JSON file and emits a "change" event whenever the rule
 * set is mutated. The policy engine reads through `list()` on every evaluation,
 * and the API broadcasts "change" over WebSocket — together that is how a
 * dashboard edit reaches the running agent with no restart.
 */

import { EventEmitter } from "node:events";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { v4 as uuid } from "uuid";
import type { Rule } from "../types.js";

/** A few sensible defaults so the system is interesting on first boot. */
function seedRules(): Rule[] {
  const now = new Date().toISOString();
  return [
    {
      id: uuid(),
      type: "block",
      name: "Never delete databases",
      enabled: true,
      createdAt: now,
      tool: "delete_database",
    },
    {
      id: uuid(),
      type: "block",
      name: "Never read raw secrets",
      enabled: true,
      createdAt: now,
      tool: "read_secret",
    },
    {
      id: uuid(),
      type: "approval",
      name: "Restarting a service needs approval",
      enabled: true,
      createdAt: now,
      tool: "restart_service",
    },
    {
      id: uuid(),
      type: "budget",
      name: "Token budget per conversation",
      enabled: true,
      createdAt: now,
      maxTokens: 50000,
    },
    {
      // Defense-in-depth against prompt injection: if the agent is manipulated
      // into forwarding attacker text into a tool call, this catches the
      // tell-tale phrases in ANY argument and blocks the call. The primary
      // defense is still structural (the guard sits outside the model), but
      // this makes injection handling visible and enforced in the dashboard.
      id: uuid(),
      type: "validation",
      name: "Block prompt-injection phrases in tool inputs",
      enabled: true,
      createdAt: now,
      tool: "*",
      argument: "*",
      constraint: {
        kind: "denyContains",
        value:
          "ignore previous instructions|ignore all previous|disregard the above|you are now in|maintenance mode|system override",
      },
    },
  ];
}

type RuleInput =
  | Omit<Extract<Rule, { type: "block" }>, "id" | "createdAt">
  | Omit<Extract<Rule, { type: "approval" }>, "id" | "createdAt">
  | Omit<Extract<Rule, { type: "validation" }>, "id" | "createdAt">
  | Omit<Extract<Rule, { type: "budget" }>, "id" | "createdAt">;

export class RuleStore extends EventEmitter {
  private rules: Rule[] = [];

  constructor(private readonly filePath: string) {
    super();
    this.load();
  }

  private load(): void {
    if (existsSync(this.filePath)) {
      try {
        this.rules = JSON.parse(readFileSync(this.filePath, "utf8"));
        return;
      } catch {
        console.error("[RuleStore] could not parse rules file; reseeding.");
      }
    }
    this.rules = seedRules();
    this.persist();
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.rules, null, 2));
  }

  /** Notify listeners (and persist) after any mutation. */
  private changed(): void {
    this.persist();
    this.emit("change", this.list());
  }

  list(): Rule[] {
    // Return copies so callers cannot mutate internal state directly.
    return this.rules.map((r) => ({ ...r }));
  }

  get(id: string): Rule | undefined {
    const found = this.rules.find((r) => r.id === id);
    return found ? { ...found } : undefined;
  }

  create(input: RuleInput): Rule {
    const rule = {
      ...input,
      id: uuid(),
      createdAt: new Date().toISOString(),
    } as Rule;
    this.rules.push(rule);
    this.changed();
    return { ...rule };
  }

  update(id: string, patch: Partial<Rule>): Rule | undefined {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    // Preserve id/type/createdAt; allow the rest to be patched.
    this.rules[idx] = {
      ...this.rules[idx],
      ...patch,
      id: this.rules[idx].id,
      type: this.rules[idx].type,
      createdAt: this.rules[idx].createdAt,
    } as Rule;
    this.changed();
    return { ...this.rules[idx] };
  }

  toggle(id: string): Rule | undefined {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) return undefined;
    rule.enabled = !rule.enabled;
    this.changed();
    return { ...rule };
  }

  remove(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    const removed = this.rules.length < before;
    if (removed) this.changed();
    return removed;
  }
}

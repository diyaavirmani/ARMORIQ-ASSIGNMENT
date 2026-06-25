// Thin REST client. The base is empty in production (same origin) and proxied
// to :8080 in dev via vite.config.ts.

import type { Rule } from "./types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getRules: () => req<{ rules: Rule[] }>("/rules"),
  createRule: (rule: Partial<Rule>) =>
    req<{ rule: Rule }>("/rules", { method: "POST", body: JSON.stringify(rule) }),
  toggleRule: (id: string) =>
    req<{ rule: Rule }>(`/rules/${id}/toggle`, { method: "POST" }),
  deleteRule: (id: string) =>
    req<{ ok: boolean }>(`/rules/${id}`, { method: "DELETE" }),

  getTools: () => req<{ tools: unknown[] }>("/tools"),
  getServers: () => req<{ servers: unknown[] }>("/servers"),

  resolveApproval: (id: string, approved: boolean) =>
    req(`/approvals/${id}`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),

  chat: (conversationId: string, message: string) =>
    req<{ reply: string }>("/chat", {
      method: "POST",
      body: JSON.stringify({ conversationId, message }),
    }),

  reset: (conversationId: string) =>
    req(`/conversations/${conversationId}/reset`, { method: "POST" }),
};

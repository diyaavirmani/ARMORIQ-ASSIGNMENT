/**
 * HTTP + WebSocket API that connects the dashboard to the running agent.
 *
 * REST handles request/response actions (rule CRUD, listing tools, sending a
 * chat turn, resolving an approval). The WebSocket pushes live events the other
 * direction (log lines, rule changes, new approval requests) so the dashboard
 * reflects the agent's state in real time.
 *
 * Live propagation, concretely: a rule edit hits POST /api/rules -> RuleStore
 * mutates and emits "change" -> the policy engine reads the new rules on the
 * very next evaluation, and this server broadcasts "rule:change" so every open
 * dashboard updates. No restart anywhere.
 */

import express from "express";
import cors from "cors";
import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { RuleStore } from "../store/RuleStore.js";
import type { LogStore } from "../store/LogStore.js";
import type { ApprovalManager } from "../approvals/ApprovalManager.js";
import type { McpClientManager } from "../mcp/McpClientManager.js";
import type { Agent } from "../agent/Agent.js";
import type { Rule } from "../types.js";

interface ApiDeps {
  port: number;
  rules: RuleStore;
  logs: LogStore;
  approvals: ApprovalManager;
  mcp: McpClientManager;
  agent: Agent;
}

export function startApiServer(deps: ApiDeps): HttpServer {
  const { rules, logs, approvals, mcp, agent } = deps;
  const app = express();
  app.use(cors());
  app.use(express.json());

  // --- Tools & server health (live discovery, never hardcoded) -------------
  app.get("/api/tools", (_req, res) => res.json({ tools: mcp.listTools() }));
  app.get("/api/servers", (_req, res) => res.json({ servers: mcp.health() }));

  // --- Rules CRUD ----------------------------------------------------------
  app.get("/api/rules", (_req, res) => res.json({ rules: rules.list() }));

  app.post("/api/rules", (req, res) => {
    try {
      const rule = rules.create(req.body);
      res.status(201).json({ rule });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.patch("/api/rules/:id", (req, res) => {
    const rule = rules.update(req.params.id, req.body as Partial<Rule>);
    if (!rule) return res.status(404).json({ error: "rule not found" });
    res.json({ rule });
  });

  app.post("/api/rules/:id/toggle", (req, res) => {
    const rule = rules.toggle(req.params.id);
    if (!rule) return res.status(404).json({ error: "rule not found" });
    res.json({ rule });
  });

  app.delete("/api/rules/:id", (req, res) => {
    const ok = rules.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: "rule not found" });
    res.json({ ok: true });
  });

  // --- Logs ----------------------------------------------------------------
  app.get("/api/logs", (req, res) => {
    const conversationId = req.query.conversationId as string | undefined;
    res.json({
      logs: conversationId ? logs.byConversation(conversationId) : logs.all(),
    });
  });

  // --- Approvals -----------------------------------------------------------
  app.get("/api/approvals", (_req, res) =>
    res.json({ approvals: approvals.listPending() })
  );

  app.post("/api/approvals/:id", (req, res) => {
    const approved = Boolean(req.body?.approved);
    const result = approvals.resolve(req.params.id, approved);
    if (!result) return res.status(404).json({ error: "approval not found or already resolved" });
    res.json({ approval: result });
  });

  // --- Chat (drive the agent) ----------------------------------------------
  app.post("/api/chat", async (req, res) => {
    const { conversationId, message } = req.body ?? {};
    if (!conversationId || !message) {
      return res.status(400).json({ error: "conversationId and message are required" });
    }
    try {
      const reply = await agent.chat(conversationId, message);
      res.json({ reply });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/conversations/:id/reset", (req, res) => {
    agent.resetConversation(req.params.id);
    res.json({ ok: true });
  });

  // --- Serve the built dashboard in production (single Railway deploy) ------
  const dashboardDist = resolve(process.cwd(), "..", "dashboard", "dist");
  if (existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist));
    app.get(/^(?!\/api|\/ws).*/, (_req, res) =>
      res.sendFile(resolve(dashboardDist, "index.html"))
    );
  }

  // --- HTTP + WebSocket server ---------------------------------------------
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const clients = new Set<WebSocket>();
  function broadcast(type: string, payload: unknown) {
    const msg = JSON.stringify({ type, payload });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  wss.on("connection", (ws) => {
    clients.add(ws);
    // Send a snapshot so a freshly-opened dashboard is immediately in sync.
    ws.send(
      JSON.stringify({
        type: "snapshot",
        payload: {
          rules: rules.list(),
          tools: mcp.listTools(),
          servers: mcp.health(),
          logs: logs.all().slice(-200),
          approvals: approvals.listPending(),
        },
      })
    );
    ws.on("close", () => clients.delete(ws));
  });

  // Wire store/manager events to the socket.
  logs.on("append", (entry) => broadcast("log:append", entry));
  rules.on("change", (all) => broadcast("rule:change", all));
  approvals.on("created", (req) => broadcast("approval:created", req));
  approvals.on("resolved", (req) => broadcast("approval:resolved", req));
  mcp.setToolsChangedHandler(() =>
    broadcast("tools:changed", { tools: mcp.listTools(), servers: mcp.health() })
  );

  httpServer.listen(deps.port, () => {
    console.error(`[api] listening on http://localhost:${deps.port}`);
  });

  return httpServer;
}

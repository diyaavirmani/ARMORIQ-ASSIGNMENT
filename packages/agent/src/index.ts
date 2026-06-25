/**
 * Entrypoint: assemble the modules and start the service.
 *
 * Wiring order matters only in that the MCP servers are connected before the
 * API starts serving, so the first dashboard snapshot already lists tools.
 */

import { loadConfig } from "./config.js";
import { McpClientManager } from "./mcp/McpClientManager.js";
import { PolicyEngine } from "./policy/PolicyEngine.js";
import { RuleStore } from "./store/RuleStore.js";
import { LogStore } from "./store/LogStore.js";
import { ApprovalManager } from "./approvals/ApprovalManager.js";
import { Agent } from "./agent/Agent.js";
import { startApiServer } from "./api/server.js";

async function main() {
  const config = loadConfig();

  if (!config.openaiApiKey) {
    console.error(
      "[boot] WARNING: OPENAI_API_KEY is not set. The API will start, but chat turns will fail until you set it."
    );
  }

  // Stores
  const rules = new RuleStore(config.rulesFile);
  const logs = new LogStore();
  const approvals = new ApprovalManager(config.approvalTimeoutMs);

  // Policy engine reads rules FRESH on every call => live dashboard control.
  const policy = new PolicyEngine(() => rules.list());

  // MCP transport: connect + discover tools live.
  const mcp = new McpClientManager(config.servers);
  await mcp.connectAll();
  console.error(
    `[boot] discovered ${mcp.listTools().length} tools across ${config.servers.length} configured server(s)`
  );

  // Agent loop
  const agent = new Agent({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    mcp,
    policy,
    logs,
    approvals,
  });

  // API + WebSocket
  startApiServer({ port: config.port, rules, logs, approvals, mcp, agent });

  const shutdown = async () => {
    console.error("[boot] shutting down...");
    await mcp.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});

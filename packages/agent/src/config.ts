/**
 * Loads runtime configuration: environment variables and the MCP server list.
 *
 * servers.json is pure config — the agent never hardcodes which tools exist,
 * only which servers to connect to. Adding a server here (and restarting, or
 * hitting the reload endpoint) makes its tools appear automatically.
 */

import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { ServerConfig } from "./mcp/McpClientManager.js";

export interface AppConfig {
  port: number;
  openaiApiKey: string;
  openaiModel: string;
  approvalTimeoutMs: number;
  rulesFile: string;
  serversFile: string;
  servers: ServerConfig[];
}

function resolveFromRoot(...segments: string[]): string {
  // The agent runs from packages/agent; project root is two levels up.
  return resolve(process.cwd(), ...segments);
}

export function loadConfig(): AppConfig {
  const serversFile =
    process.env.SERVERS_FILE ?? resolveFromRoot("..", "..", "servers.json");

  let servers: ServerConfig[] = [];
  if (existsSync(serversFile)) {
    try {
      const raw = JSON.parse(readFileSync(serversFile, "utf8"));
      servers = raw.servers ?? raw;
      // Default the working directory of stdio child processes to the project
      // root (where servers.json lives) so relative script paths resolve.
      const root = dirname(serversFile);
      servers = servers.map((s) =>
        s.transport === "stdio" && !s.cwd ? { ...s, cwd: root } : s
      );
    } catch (err) {
      console.error(`[config] failed to parse ${serversFile}:`, err);
    }
  } else {
    console.error(`[config] no servers file found at ${serversFile}`);
  }

  return {
    port: Number(process.env.PORT ?? 8080),
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    approvalTimeoutMs: Number(process.env.APPROVAL_TIMEOUT_MS ?? 60_000),
    rulesFile: process.env.RULES_FILE ?? resolveFromRoot("data", "rules.json"),
    serversFile,
    servers,
  };
}

/**
 * McpClientManager — the MCP transport layer.
 *
 * Connects to every MCP server listed in servers.json, discovers their tools
 * LIVE (nothing is hardcoded), and exposes a uniform interface for the agent to
 * call those tools. Tool names are qualified per-server to avoid collisions.
 *
 * Robustness is a first-class concern here because tools are external processes
 * or remote services that can be slow, crash, or vanish:
 *  - Every tool call is wrapped in a timeout and try/catch. A dead transport
 *    yields a structured tool error (fed back to the model) rather than a hang.
 *  - Per-server health is tracked. If a server fails to connect, its tools
 *    simply don't appear in discovery — the agent degrades instead of breaking.
 *  - We subscribe to the MCP `tools/list_changed` notification so that a server
 *    adding/removing tools at runtime is reflected without a restart.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolDescriptor } from "../types.js";

export interface ServerConfig {
  id: string;
  label: string;
  transport: "stdio" | "sse" | "http";
  enabled?: boolean;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Working directory for a stdio child process (defaults to servers.json dir). */
  cwd?: string;
  // sse / http
  url?: string;
  headers?: Record<string, string>;
}

export interface ServerHealth {
  id: string;
  label: string;
  transport: string;
  status: "connected" | "error" | "disabled";
  toolCount: number;
  error?: string;
}

export interface ToolCallResult {
  ok: boolean;
  text: string;
  isError: boolean;
}

interface Connection {
  config: ServerConfig;
  client?: Client;
  tools: ToolDescriptor[];
  status: ServerHealth["status"];
  error?: string;
}

/** OpenAI function names allow [a-zA-Z0-9_-]; sanitize server ids accordingly. */
function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

const CALL_TIMEOUT_MS = 30_000;

export class McpClientManager {
  private connections = new Map<string, Connection>();
  /** qualifiedName -> { serverId, toolName } for routing calls back. */
  private routing = new Map<string, { serverId: string; toolName: string }>();
  private onToolsChanged?: () => void;

  constructor(private readonly configs: ServerConfig[]) {}

  /** Register a callback fired whenever the available tool set changes. */
  setToolsChangedHandler(fn: () => void): void {
    this.onToolsChanged = fn;
  }

  async connectAll(): Promise<void> {
    await Promise.all(this.configs.map((c) => this.connect(c)));
    this.rebuildRouting();
  }

  private async connect(config: ServerConfig): Promise<void> {
    if (config.enabled === false) {
      this.connections.set(config.id, {
        config,
        tools: [],
        status: "disabled",
      });
      return;
    }

    const conn: Connection = { config, tools: [], status: "error" };
    this.connections.set(config.id, conn);

    try {
      const client = new Client(
        { name: "armoriq-agent", version: "1.0.0" },
        { capabilities: {} }
      );
      const transport = this.makeTransport(config);
      await client.connect(transport);

      conn.client = client;
      conn.status = "connected";

      // Refresh this server's tools whenever it announces a change.
      client.setNotificationHandler =
        client.setNotificationHandler?.bind(client);
      client.fallbackNotificationHandler = async (n) => {
        if (n.method === "notifications/tools/list_changed") {
          await this.refreshTools(config.id);
          this.rebuildRouting();
          this.onToolsChanged?.();
        }
      };

      await this.refreshTools(config.id);
      console.error(
        `[mcp] connected "${config.id}" (${config.transport}) — ${conn.tools.length} tools`
      );
    } catch (err) {
      conn.status = "error";
      conn.error = err instanceof Error ? err.message : String(err);
      console.error(`[mcp] failed to connect "${config.id}": ${conn.error}`);
    }
  }

  private makeTransport(config: ServerConfig) {
    switch (config.transport) {
      case "stdio":
        if (!config.command)
          throw new Error(`stdio server "${config.id}" needs a command`);
        return new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          cwd: config.cwd,
          env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
        });
      case "sse":
        if (!config.url) throw new Error(`sse server "${config.id}" needs a url`);
        return new SSEClientTransport(new URL(config.url));
      case "http":
        if (!config.url) throw new Error(`http server "${config.id}" needs a url`);
        return new StreamableHTTPClientTransport(new URL(config.url));
      default:
        throw new Error(`unknown transport for server "${config.id}"`);
    }
  }

  private async refreshTools(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn?.client) return;
    const { tools } = await conn.client.listTools();
    conn.tools = tools.map((t) => ({
      serverId: conn.config.id,
      serverLabel: conn.config.label,
      name: t.name,
      qualifiedName: `${sanitize(conn.config.id)}__${t.name}`,
      description: t.description ?? "",
      inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<
        string,
        unknown
      >,
    }));
  }

  private rebuildRouting(): void {
    this.routing.clear();
    for (const conn of this.connections.values()) {
      for (const tool of conn.tools) {
        this.routing.set(tool.qualifiedName, {
          serverId: conn.config.id,
          toolName: tool.name,
        });
      }
    }
  }

  /** All tools from all currently-connected servers. The agent's only source of truth. */
  listTools(): ToolDescriptor[] {
    const all: ToolDescriptor[] = [];
    for (const conn of this.connections.values()) {
      if (conn.status === "connected") all.push(...conn.tools);
    }
    return all;
  }

  findTool(qualifiedName: string): ToolDescriptor | undefined {
    return this.listTools().find((t) => t.qualifiedName === qualifiedName);
  }

  health(): ServerHealth[] {
    return [...this.connections.values()].map((c) => ({
      id: c.config.id,
      label: c.config.label,
      transport: c.config.transport,
      status: c.status,
      toolCount: c.tools.length,
      error: c.error,
    }));
  }

  /**
   * Execute a tool by its qualified name. Never throws: failures (timeout,
   * crash, transport error) come back as a structured error result so the
   * agent loop can feed them to the model and keep going.
   */
  async callTool(
    qualifiedName: string,
    args: Record<string, unknown>
  ): Promise<ToolCallResult> {
    const route = this.routing.get(qualifiedName);
    if (!route) {
      return {
        ok: false,
        isError: true,
        text: `Tool "${qualifiedName}" is not available (server may be down).`,
      };
    }
    const conn = this.connections.get(route.serverId);
    if (!conn?.client || conn.status !== "connected") {
      return {
        ok: false,
        isError: true,
        text: `MCP server "${route.serverId}" is not connected.`,
      };
    }

    try {
      const result = await this.withTimeout(
        conn.client.callTool({ name: route.toolName, arguments: args }),
        CALL_TIMEOUT_MS,
        `Tool "${route.toolName}" timed out after ${CALL_TIMEOUT_MS}ms`
      );

      const text = this.extractText(result);
      const isError = Boolean((result as { isError?: boolean }).isError);
      return { ok: !isError, isError, text };
    } catch (err) {
      // A crash mid-call lands here. Mark the server unhealthy so its tools
      // drop out of discovery, and return a clean error to the model.
      const message = err instanceof Error ? err.message : String(err);
      conn.status = "error";
      conn.error = message;
      this.rebuildRouting();
      this.onToolsChanged?.();
      return {
        ok: false,
        isError: true,
        text: `Tool execution failed: ${message}`,
      };
    }
  }

  private extractText(result: unknown): string {
    const content = (result as { content?: Array<{ type: string; text?: string }> })
      ?.content;
    if (!Array.isArray(content)) return JSON.stringify(result);
    return content
      .map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`))
      .join("\n")
      .trim();
  }

  private withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(msg)), ms);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }

  async close(): Promise<void> {
    for (const conn of this.connections.values()) {
      try {
        await conn.client?.close();
      } catch {
        /* ignore */
      }
    }
  }
}

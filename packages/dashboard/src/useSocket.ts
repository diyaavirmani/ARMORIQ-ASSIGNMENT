import { useEffect, useRef, useState } from "react";
import type {
  ApprovalRequest,
  LogEntry,
  Rule,
  ServerHealth,
  ToolDescriptor,
} from "./types";

export interface LiveState {
  connected: boolean;
  rules: Rule[];
  tools: ToolDescriptor[];
  servers: ServerHealth[];
  logs: LogEntry[];
  approvals: ApprovalRequest[];
}

/**
 * Subscribes to the agent's WebSocket and keeps a live mirror of its state.
 * This is what makes the dashboard reflect rule changes, log lines, and
 * approval requests the instant they happen — no polling.
 */
export function useSocket(): LiveState {
  const [state, setState] = useState<LiveState>({
    connected: false,
    rules: [],
    tools: [],
    servers: [],
    logs: [],
    approvals: [],
  });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;

    function connect() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setState((s) => ({ ...s, connected: true }));
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!closed) setTimeout(connect, 1500); // auto-reconnect
      };
      ws.onmessage = (ev) => {
        const { type, payload } = JSON.parse(ev.data);
        setState((s) => {
          switch (type) {
            case "snapshot":
              return { ...s, ...payload, connected: true };
            case "rule:change":
              return { ...s, rules: payload };
            case "log:append":
              return { ...s, logs: [...s.logs, payload].slice(-500) };
            case "tools:changed":
              return { ...s, tools: payload.tools, servers: payload.servers };
            case "approval:created":
              return { ...s, approvals: [...s.approvals, payload] };
            case "approval:resolved":
              return {
                ...s,
                approvals: s.approvals.filter((a) => a.id !== payload.id),
              };
            default:
              return s;
          }
        });
      };
    }

    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, []);

  return state;
}

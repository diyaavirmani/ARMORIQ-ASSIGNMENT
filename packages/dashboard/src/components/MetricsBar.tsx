import type { LiveState } from "../useSocket";

/**
 * Top KPI cards. Every figure is derived from live backend state (rules, tools,
 * server health, logs, approvals) — nothing here is hardcoded.
 */
export function MetricsBar({ live }: { live: LiveState }) {
  const activeRules = live.rules.filter((r) => r.enabled).length;
  const serversOnline = live.servers.filter((s) => s.status === "connected").length;
  const totalServers = live.servers.length;
  const blocked = live.logs.filter(
    (l) => l.type === "policy_decision" && (l.detail?.effect as string) === "block"
  ).length;
  const pending = live.approvals.length;

  const cards = [
    { label: "Active Guardrails", value: `${activeRules}`, meta: `${live.rules.length} total` },
    { label: "Tools Discovered", value: `${live.tools.length}`, meta: `${totalServers} MCP servers` },
    { label: "Servers Online", value: `${serversOnline}`, unit: `/ ${totalServers}`, meta: serversOnline === totalServers ? "all connected" : "degraded" },
    { label: "Blocked This Session", value: `${blocked}`, meta: pending ? `${pending} awaiting approval` : "by policy", alert: blocked > 0 },
  ];

  return (
    <div className="kpi-row">
      {cards.map((c) => (
        <div className={`kpi ${c.alert ? "alert" : ""}`} key={c.label}>
          <div className="label">{c.label}</div>
          <div className="value">
            {c.value}
            {c.unit && <span className="unit"> {c.unit}</span>}
          </div>
          <div className="meta">{c.meta}</div>
        </div>
      ))}
    </div>
  );
}

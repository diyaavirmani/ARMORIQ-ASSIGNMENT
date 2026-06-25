import type { ToolDescriptor } from "../types";

export function ToolsPanel({ tools }: { tools: ToolDescriptor[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Connected Tools</h2>
        <span className="count-chip">{tools.length} live</span>
      </div>
      <div className="card-body">
        {tools.length === 0 && (
          <div className="empty">No tools — are the MCP servers connected?</div>
        )}
        {tools.map((t) => (
          <div className="tool-item" key={t.qualifiedName} title={t.description}>
            <span className="tool-name">{t.name}</span>
            <span className="tool-server">{t.serverLabel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

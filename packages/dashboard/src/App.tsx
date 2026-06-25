import { useMemo } from "react";
import { useSocket } from "./useSocket";
import { Brand, PageHeader } from "./components/Header";
import { RulesPanel } from "./components/RulesPanel";
import { ChatPanel } from "./components/ChatPanel";
import { LogPanel } from "./components/LogPanel";
import { ApprovalsPanel } from "./components/ApprovalsPanel";
import { ToolsPanel } from "./components/ToolsPanel";
import { MetricsBar } from "./components/MetricsBar";

export function App() {
  const live = useSocket();
  // One conversation per browser session.
  const conversationId = useMemo(
    () => `conv-${Math.random().toString(36).slice(2, 10)}`,
    []
  );

  return (
    <div className="app">
      <div className="shell">
        {/* Sidebar: brand + guardrails list */}
        <aside>
          <Brand />
          <RulesPanel rules={live.rules} />
        </aside>

        {/* Content: header, KPIs, work area, activity */}
        <main className="content">
          <PageHeader connected={live.connected} />
          <MetricsBar live={live} />

          <div className="content-row">
            <ChatPanel conversationId={conversationId} />
            <div className="right-col">
              <ApprovalsPanel approvals={live.approvals} />
              <ToolsPanel tools={live.tools} />
            </div>
          </div>

          <LogPanel logs={live.logs} />
        </main>
      </div>
    </div>
  );
}

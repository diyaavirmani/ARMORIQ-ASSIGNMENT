import { useRef, useEffect } from "react";
import type { LogEntry } from "../types";

function time(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

export function LogPanel({ logs }: { logs: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [logs]);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Recent Activity</h2>
        <span className="count-chip">{logs.length} events</span>
      </div>
      <div className="log" ref={ref}>
        {logs.length === 0 && <div className="empty">Nothing yet.</div>}
        {logs.map((e) => {
          const effect = (e.detail?.effect as string) ?? "";
          return (
            <div
              className={`log-line lt-${e.type} ${effect ? `effect-${effect}` : ""}`}
              key={e.id}
            >
              <span className="ts">{time(e.timestamp)}</span>
              <span className="log-badge">{e.type.replace("_", " ")}</span>
              <span className="log-msg">{e.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

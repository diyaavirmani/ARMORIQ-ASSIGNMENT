export function Brand() {
  return (
    <div className="brand">
      <span className="name">Guarded Agent</span>
    </div>
  );
}

export function PageHeader({ connected }: { connected: boolean }) {
  return (
    <div className="page-head">
      <div>
        <h1>Policy Console</h1>
        <div className="sub">
          Guardrails enforced on every tool call, in real time.
        </div>
      </div>
      <div className="status-pills">
        <span className="pill">
          <span className={`dot ${connected ? "connected" : "error"}`} />
          {connected ? "live" : "reconnecting"}
        </span>
      </div>
    </div>
  );
}

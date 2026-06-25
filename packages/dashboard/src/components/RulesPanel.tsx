import { useState } from "react";
import { api } from "../api";
import type { Rule, RuleType } from "../types";

function ruleDetail(r: Rule): string {
  switch (r.type) {
    case "block":
      return `blocks tool: ${r.tool}`;
    case "approval":
      return `requires approval: ${r.tool}`;
    case "validation":
      return `${r.tool}.${r.argument} ${r.constraint?.kind} "${r.constraint?.value}"`;
    case "budget":
      return `max ${r.maxTokens?.toLocaleString()} tokens / conversation`;
    default:
      return "";
  }
}

type Filter = "all" | RuleType;
const TABS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "block", label: "Block" },
  { key: "approval", label: "Approval" },
  { key: "validation", label: "Validation" },
  { key: "budget", label: "Budget" },
];

export function RulesPanel({ rules }: { rules: Rule[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = filter === "all" ? rules : rules.filter((r) => r.type === filter);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Guardrails</h2>
        <span className="count-chip">{rules.filter((r) => r.enabled).length} active</span>
      </div>
      <div className="card-body">
        <div className="gr-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`gr-tab ${filter === t.key ? "active" : ""}`}
              onClick={() => setFilter(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {shown.length === 0 && <div className="empty">No guardrails here.</div>}
        {shown.map((r) => (
          <div className={`rule t-${r.type} ${r.enabled ? "" : "disabled"}`} key={r.id}>
            <div className="rule-top">
              <span className={`tag ${r.type}`}>{r.type}</span>
              <span className="rule-name">{r.name}</span>
              <div className="rule-actions">
                <label className="switch">
                  <input type="checkbox" checked={r.enabled} onChange={() => api.toggleRule(r.id)} />
                  <span className="slider" />
                </label>
                <button className="icon-btn" title="Delete rule" onClick={() => api.deleteRule(r.id)}>
                  ✕
                </button>
              </div>
            </div>
            <div className="rule-detail">{ruleDetail(r)}</div>
          </div>
        ))}

        <AddRuleForm />
      </div>
    </div>
  );
}

function AddRuleForm() {
  const [type, setType] = useState<RuleType>("block");
  const [name, setName] = useState("");
  const [tool, setTool] = useState("");
  const [argument, setArgument] = useState("");
  const [kind, setKind] = useState("prefix");
  const [value, setValue] = useState("");
  const [maxTokens, setMaxTokens] = useState("50000");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const base: Partial<Rule> = { type, name: name || `${type} rule`, enabled: true };
      if (type === "block" || type === "approval") base.tool = tool || "*";
      if (type === "validation") {
        base.tool = tool || "*";
        base.argument = argument;
        base.constraint = { kind, value };
      }
      if (type === "budget") base.maxTokens = Number(maxTokens);
      await api.createRule(base);
      setName(""); setTool(""); setArgument(""); setValue("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="add-rule">
      <summary>+ Add guardrail</summary>
      <div style={{ marginTop: 8 }}>
        <label className="field">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as RuleType)}>
            <option value="block">Block a tool</option>
            <option value="approval">Require approval</option>
            <option value="validation">Validate input</option>
            <option value="budget">Token budget</option>
          </select>
        </label>
        <label className="field">
          <span>Rule name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Block deletes" />
        </label>

        {(type === "block" || type === "approval" || type === "validation") && (
          <label className="field">
            <span>Tool (name or * for all)</span>
            <input value={tool} onChange={(e) => setTool(e.target.value)} placeholder="delete_database or *" />
          </label>
        )}

        {type === "validation" && (
          <>
            <label className="field">
              <span>Argument (* scans all)</span>
              <input value={argument} onChange={(e) => setArgument(e.target.value)} placeholder="path or *" />
            </label>
            <div className="row">
              <label className="field">
                <span>Constraint</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="prefix">must start with</option>
                  <option value="regex">must match regex</option>
                  <option value="denyContains">must not contain</option>
                  <option value="maxLength">max length</option>
                </select>
              </label>
              <label className="field">
                <span>Value</span>
                <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="/sandbox/" />
              </label>
            </div>
          </>
        )}

        {type === "budget" && (
          <label className="field">
            <span>Max tokens / conversation</span>
            <input type="number" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
          </label>
        )}

        <button className="btn primary" onClick={submit} disabled={busy} style={{ width: "100%" }}>
          {busy ? "Adding…" : "Add guardrail"}
        </button>
      </div>
    </details>
  );
}

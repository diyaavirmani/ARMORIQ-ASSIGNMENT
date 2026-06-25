import { useRef, useState, useEffect } from "react";
import { api } from "../api";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "List all the servers and their status.",
  "Read the logs for billing-api.",
  "Restart the analytics-worker service.",
  "Delete the production database.",
  "Read the secret STRIPE_API_KEY.",
];

export function ChatPanel({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    try {
      const { reply } = await api.chat(conversationId, text);
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Error: ${(err as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    await api.reset(conversationId);
    setMessages([]);
  }

  return (
    <div className="card chat">
      <div className="card-head">
        <div>
          <h2>Agent</h2>
          <div className="sub">Ask it to operate the infrastructure</div>
        </div>
        <button className="link-btn" onClick={reset}>
          reset
        </button>
      </div>

      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && (
          <div className="empty">
            Ask the agent to do something. Try a safe action, then a dangerous one,
            and watch the guardrails on the right.
          </div>
        )}
        {messages.map((m, i) => (
          <div className={`msg ${m.role}`} key={i}>
            <div className="who">{m.role}</div>
            {m.content}
          </div>
        ))}
        {busy && <div className="thinking">agent is working…</div>}
      </div>

      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <span className="chip" key={s} onClick={() => send(s)}>
            {s}
          </span>
        ))}
      </div>

      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder="Tell the agent what to do…"
        />
        <button className="btn primary" onClick={() => send(input)} disabled={busy}>
          Send
        </button>
      </div>
    </div>
  );
}

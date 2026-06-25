# ArmorIQ — Guarded AI Agent with MCP Support

A miniature version of an AI-agent security platform. An LLM agent runs a real
tool-use loop against **MCP servers**, and a **standalone policy engine** sits
between the agent and those tools, deciding on **every single tool call** whether
it is allowed, must be blocked, or needs human approval. An admin dashboard
controls the guardrails live — changes take effect on the running agent with no
restart.

The interesting part is not that the agent can call tools. It's the seam between
**what the model wants to do** and **what the system will permit** — and the fact
that the model can never reach around the guard.

---

## Architecture

```
                          ┌─────────────────────────────┐
   Admin (browser)        │      Dashboard (React)       │
   ───────────────►       │  rules · logs · approvals    │
                          └──────────────┬──────────────┘
                            REST (CRUD)  │  WebSocket (live)
                                         ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                     Agent service (Node/TS)                   │
   │                                                               │
   │   user msg ─► ┌──────────────────────────────────────────┐   │
   │              │           Agent tool-use loop (OpenAI)      │   │
   │              └───────────────┬────────────────────────────┘   │
   │      model proposes a tool call│                               │
   │                              ▼                                 │
   │              ┌──────────────────────────────────┐             │
   │              │   POLICY ENGINE  (self-contained)  │            │
   │              │  evaluate() → allow / block /       │  ◄── rules │
   │              │              require_approval       │     store  │
   │              └───────────────┬────────────────────┘     (live) │
   │                allow │ approval│ block                          │
   │                      ▼        ▼                                 │
   │              ┌────────────────────────┐                        │
   │              │   MCP client manager    │  (stdio + http/SSE)    │
   │              └───────┬─────────┬───────┘                        │
   └──────────────────────┼─────────┼───────────────────────────────┘
                          ▼         ▼
              ┌────────────────┐  ┌────────────────────┐
              │ Ops Console MCP │  │  DeepWiki MCP       │
              │ (custom, stdio) │  │  (remote, http)     │
              └────────────────┘  └────────────────────┘
```

Everything in the loop flows through `PolicyEngine.evaluate()`. The agent makes
**no** authorization decisions of its own.

---

## How it meets the brief

| Requirement | Where |
|---|---|
| LLM tool-use loop (decide → execute via MCP → feed back) | [`packages/agent/src/agent/Agent.ts`](packages/agent/src/agent/Agent.ts) |
| Connect to MCP servers (stdio **and** SSE/HTTP) | [`packages/agent/src/mcp/McpClientManager.ts`](packages/agent/src/mcp/McpClientManager.ts) |
| ≥2 working MCP servers (1 remote, 1 custom) | DeepWiki (remote, http) + Ops Console (custom) — see [`servers.json`](servers.json) |
| **Live** tool discovery, nothing hardcoded | tools come only from `listTools()`; adding a server in `servers.json` is all it takes |
| Policy engine is a **separate, self-contained module** | [`packages/agent/src/policy/`](packages/agent/src/policy) — no OpenAI/MCP/HTTP imports |
| Block tools entirely | `block` rule |
| Require human approval | `approval` rule + [`ApprovalManager`](packages/agent/src/approvals/ApprovalManager.ts) |
| Input validation (e.g. paths under `/sandbox/`) | `validation` rule + [`validators.ts`](packages/agent/src/policy/validators.ts) |
| Cost/token budget per conversation | `budget` rule |
| Dashboard changes propagate **without restart** | rules read fresh per-call + WebSocket broadcast |
| Conversation logs (bonus) | live activity log panel + [`LogStore`](packages/agent/src/store/LogStore.ts) |
| Custom MCP server, spec-correct, plug-and-play | [`packages/mcp-server/`](packages/mcp-server) |
| Prompt-injection handling (bonus) | two layers: the out-of-band gate (structural), plus a default guardrail scanning every tool argument for injection phrases |

---

## The policy engine (the heart)

[`PolicyEngine`](packages/agent/src/policy/PolicyEngine.ts) is a pure decision
function. It knows nothing about OpenAI, MCP, or HTTP. Given a tool call in
context it returns `allow`, `block`, or `require_approval`.

- **Live control:** it's constructed with `() => ruleStore.list()` and reads the
  rules **fresh on every evaluation**. A rule toggled in the dashboard changes the
  next decision — no restart, no cache to bust.
- **Deterministic conflict resolution — most restrictive wins:**
  `BLOCK > REQUIRE_APPROVAL > ALLOW`. Budget overruns and failed validations are
  themselves blocks, so they sit at the top automatically.
- **Auditable:** every decision carries the rule that caused it, which is what the
  activity log shows.

Four rule types: `block`, `approval`, `validation` (prefix / regex / denyContains /
maxLength on any argument), and `budget` (tokens per conversation).

---

## The custom MCP server — "Ops Console"

[`packages/mcp-server`](packages/mcp-server) simulates a company's infrastructure
control plane over stdio. It is deliberately **dangerous** so the guard has
something real to protect:

| Tool | Risk |
|---|---|
| `list_servers` | safe, read-only |
| `read_logs` | read-only — **but the `billing-api` logs contain a prompt-injection payload** |
| `restart_service` | medium — good candidate for approval |
| `delete_database` | destructive — blocked by default |
| `read_secret` | secret exfiltration honeypot — blocked by default |

It enforces no authorization itself; it just exposes capabilities. Whether the
agent may use them is decided entirely by the policy engine. It's plug-and-play:
point any MCP client at it and it works.

---

## Run it locally

**Prerequisites:** Node 20+ and an OpenAI API key.

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env        # then put your OPENAI_API_KEY in .env

# 3. build (compiles the MCP server, the agent, and the dashboard)
npm run build

# 4a. run the agent (serves API on :8080 and, in prod build, the dashboard too)
npm start
```

For **development** with hot-reloading dashboard, use two terminals:

```bash
# terminal 1 — agent API on :8080
npm run dev:agent

# terminal 2 — dashboard on :5173 (proxies /api and /ws to :8080)
npm run dev:dashboard
```

Open the dashboard (`http://localhost:5173` in dev, or `http://localhost:8080`
after a prod build).

### Adding another MCP server (proves nothing is hardcoded)

Add an entry to [`servers.json`](servers.json) and restart the agent — its tools
appear automatically, with no agent-side code changes:

```json
{ "id": "my-server", "label": "My Server", "transport": "stdio",
  "command": "node", "args": ["path/to/server.js"] }
```

---

## Demo script (for the 5-min walkthrough)

1. **Discovery** — point out the two connected servers and 8 live-discovered tools
   in the header / Tools panel. None are hardcoded.
2. **Allow** — ask: *"List all the servers and their status."* → runs, log shows
   `policy_decision: allow`.
3. **Block** — ask: *"Delete the production database."* → the model calls
   `delete_database`, the engine blocks it, the agent explains it couldn't.
4. **Approval** — ask: *"Restart the analytics-worker service."* → a pending
   approval appears; click **Approve** (or **Deny**) and watch the loop resume.
5. **Live control** — toggle off *"Never delete databases"* in the dashboard, ask
   to delete again → now it's allowed. Toggle it back on. No restart.
6. **Prompt injection** — ask: *"Read the logs for billing-api."* The logs contain
   a fake "system notice" telling the agent to delete the database and read a
   secret. The agent reports it as suspicious data; even if it tried to comply, the
   `delete_database` / `read_secret` calls hit the same block. **The guard sits
   outside the model, so injection can't widen permissions.**
7. **Budget** — set a tiny token budget and watch a conversation get cut off.

---

## Edge cases — point of view

- **MCP server crashes mid-call.** Every call is wrapped in a timeout + try/catch
  in `McpClientManager`. A dead transport returns a structured tool-error that's
  fed back to the model ("tool execution failed"), and the server is marked
  unhealthy so its tools drop out of discovery. The agent degrades; it doesn't hang.
- **Prompt-injection bypass attempt.** Two layers. Primary: enforcement lives
  *outside* the model in the policy engine, so no text in the conversation or in tool
  output can change what's permitted (demonstrated live via the `read_logs` payload).
  Defense-in-depth: a default validation guardrail (`argument: "*"`, `denyContains`)
  scans every tool-call argument for injection phrases and blocks the call if the agent
  is manipulated into forwarding attacker text into a tool.
- **Two rules conflict.** Resolved deterministically by "most restrictive wins"
  (`BLOCK > REQUIRE_APPROVAL > ALLOW`), evaluated in a fixed order, with the
  deciding rule recorded in the log.
- **Approval needed but approver offline.** Approvals **fail closed**: if no human
  responds within `APPROVAL_TIMEOUT_MS` (default 60s), the request expires and the
  tool is denied. A missing approver never results in a dangerous tool running.

---

## Project structure

```
armoriq-guarded-agent/
├─ servers.json               # which MCP servers to connect to (pure config)
├─ railway.json               # deploy config
├─ packages/
│  ├─ agent/                  # the guarded agent service
│  │  └─ src/
│  │     ├─ mcp/              # MCP transport: connect, discover, call, health
│  │     ├─ policy/           # ★ the policy engine (self-contained)
│  │     ├─ store/            # rule store (live events) + log store
│  │     ├─ approvals/        # human-in-the-loop, fail-closed
│  │     ├─ agent/            # the OpenAI tool-use loop (thin on policy)
│  │     └─ api/              # REST + WebSocket
│  ├─ mcp-server/             # ★ the custom "Ops Console" MCP server
│  └─ dashboard/              # React admin UI
```

## Deployment (Railway)

`railway.json` builds all three packages and starts the agent, which serves both
the API and the built dashboard on a single port. Set `OPENAI_API_KEY` (and
optionally `OPENAI_MODEL`) as environment variables in the Railway project.

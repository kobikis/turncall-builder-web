import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { canEdit } from "../roles";
import Uid from "../components/Uid";
import { agentStatus, answersCalls } from "../agentStatus";
import { Agent, ApiResponse } from "../types";

// Two states, not six: an operator asks which agents are answering and which
// are not, and `answersCalls` is the one place that split is defined.
type Filter = "all" | "ready" | "offline";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "offline", label: "Offline" },
];

export default function AgentsList() {
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role); // viewers get a read-only list
  const [agents, setAgents] = useState<Agent[] | null>(null); // null = loading
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<Filter>("all");
  const [sortDesc, setSortDesc] = useState(false); // by name, ascending default

  useEffect(() => {
    api<ApiResponse<{ agents: Agent[] }>>("/agents")
      .then((r) => setAgents(r.data.agents))
      .catch((e) => setError(e.message));
  }, []);

  // Filter by status, then by id or name, then sort by name.
  const visible = (agents || [])
    .filter((a) => only === "all" || answersCalls(a.status) === (only === "ready"))
    .filter((a) => {
      const s = q.trim().toLowerCase();
      return !s || (a.name || "").toLowerCase().includes(s) || a.agent_id.toLowerCase().includes(s);
    })
    .sort((a, b) => (sortDesc ? -1 : 1) * (a.name || "").localeCompare(b.name || ""));

  return (
    <div>
      <div className="page-head">
        {/* No subtitle. "Voice agents composed with the builder, each with its
            own generated backend" described how the system is built, to an
            audience that came here to see whether the phone is being
            answered. */}
        <h2>
          Agents
          {/* The count beside the word, not welded to it with a separator: a
              middle-dot meta string ("Agents · 2") is the house style of every
              generated page. */}
          {agents !== null && agents.length > 0 && (
            <span className="count">{agents.length}</span>
          )}
        </h2>
        {editable && (
          <Link to="/agents/new" className="btn btn-primary">+ New agent</Link>
        )}
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
      {/* Search and filter on one line, because they answer one question
          between them: which of these do I want to look at. */}
      <div className="toolbar">
        <input
          className="input"
          style={{ maxWidth: 360 }}
          aria-label="Search agents by id or name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or id (e.g. Reception or 3f2a…)"
        />
        <div className="filters" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`filter${only === f.id ? " active" : ""}`}
              aria-pressed={only === f.id}
              onClick={() => setOnly(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <table className="list">
        <thead>
          <tr>
            <th>
              <button
                className="row-toggle"
                onClick={() => setSortDesc((v) => !v)}
                aria-label={`Sort by name, ${sortDesc ? "descending" : "ascending"} — click to reverse`}
              >
                Name <span className="caret" aria-hidden="true">{sortDesc ? "▾" : "▴"}</span>
              </button>
            </th>
            <th>ID</th><th>Port</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((a) => (
            <tr key={a.agent_id}>
              <td style={{ fontWeight: 500 }}>
                <Link to={`/agents/${a.agent_id}`}>{a.name}</Link>
              </td>
              <td><Uid id={a.agent_id} label="agent_id" /></td>
              <td className="num"><code>:{a.port}</code></td>
              <td>
                <span className={`badge ${a.status}`} title={agentStatus(a.status).title}>
                  {agentStatus(a.status).label}
                </span>
              </td>
            </tr>
          ))}
          {agents === null && !error && (
            <tr><td colSpan={4} className="muted" style={{ padding: 16 }}>Loading…</td></tr>
          )}
          {agents?.length === 0 && (
            <tr>
              <td colSpan={4} className="muted" style={{ padding: 16 }}>
                No agents yet. Create one to start answering calls.
              </td>
            </tr>
          )}
          {agents && agents.length > 0 && visible.length === 0 && (
            <tr>
              <td colSpan={4} className="muted" style={{ padding: 16 }}>
                {q.trim() ? `No agents match “${q}”.` : "No agents in this state."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { canEdit } from "../roles";
import Uid from "../components/Uid";
import { Agent, ApiResponse } from "../types";

export default function AgentsList() {
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role); // viewers get a read-only list
  const [agents, setAgents] = useState<Agent[] | null>(null); // null = loading
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [sortDesc, setSortDesc] = useState(false); // by name, ascending default

  useEffect(() => {
    api<ApiResponse<{ agents: Agent[] }>>("/agents")
      .then((r) => setAgents(r.data.agents))
      .catch((e) => setError(e.message));
  }, []);

  // Filter by id or name, then sort by name.
  const visible = (agents || [])
    .filter((a) => {
      const s = q.trim().toLowerCase();
      return !s || (a.name || "").toLowerCase().includes(s) || a.agent_id.toLowerCase().includes(s);
    })
    .sort((a, b) => (sortDesc ? -1 : 1) * (a.name || "").localeCompare(b.name || ""));

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Agents</h2>
          <p>Voice agents composed with the builder, each with its own generated backend.</p>
        </div>
        {editable && (
          <Link to="/agents/new" className="btn btn-primary">+ New agent</Link>
        )}
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
      <input
        className="input"
        style={{ marginBottom: 10, maxWidth: 360 }}
        aria-label="Search agents by id or name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or id (e.g. Reception or 3f2a…)"
      />
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
            <th>ID</th><th>Backend</th><th>Status</th>
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
              <td><span className={`badge ${a.status}`}>{a.status}</span></td>
            </tr>
          ))}
          {agents === null && !error && (
            <tr><td colSpan={4} className="muted" style={{ padding: 16 }}>Loading…</td></tr>
          )}
          {agents?.length === 0 && (
            <tr><td colSpan={4} className="muted" style={{ padding: 16 }}>No agents yet — create one.</td></tr>
          )}
          {agents && agents.length > 0 && visible.length === 0 && (
            <tr><td colSpan={4} className="muted" style={{ padding: 16 }}>No agents match “{q}”.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

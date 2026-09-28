import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { canEdit } from "../roles";
import Uid from "../components/Uid";
import { agentStatus, answersCalls } from "../agentStatus";
import { Agent, AgentActivity, ApiResponse } from "../types";
import Ribbon from "../components/Ribbon";
import SkeletonRows from "../components/SkeletonRows";

// Two states, not six: an operator asks which agents are answering and which
// are not, and `answersCalls` is the one place that split is defined.
type Filter = "all" | "ready" | "offline";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "offline", label: "Offline" },
];

export default function AgentsList() {
  const navigate = useNavigate();
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role); // viewers get a read-only list
  const [agents, setAgents] = useState<Agent[] | null>(null); // null = loading
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<Filter>("all");
  const [activity, setActivity] = useState<Record<string, AgentActivity>>({});
  const [sortDesc, setSortDesc] = useState(false); // by name, ascending default

  useEffect(() => {
    api<ApiResponse<{ agents: Agent[] }>>("/agents")
      .then((r) => setAgents(r.data.agents))
      .catch((e) => setError(e.message));
  }, []);

  // A second request, deliberately: the list is one registry query and paints
  // at once, while this one asks TurnCall per agent. A failure here is silent
  // in the page's error banner and shows as "no data" per row — the list of
  // agents is still correct, and saying the page failed would be a lie.
  useEffect(() => {
    api<ApiResponse<{ activity: AgentActivity[] }>>("/agent-activity")
      .then((r) =>
        setActivity(Object.fromEntries(r.data.activity.map((a) => [a.agent_id, a])))
      )
      .catch(() => setActivity({}));
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
      <table className="list" aria-busy={agents === null}>
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
            <th>Number</th><th>Last 24 hours</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((a) => (
            <tr
              key={a.agent_id}
              className="row-link"
              // The row is a shortcut, not the control: the name inside it is
              // still the link, which is what keyboard and screen-reader users
              // follow and what a middle-click opens in a new tab. A click that
              // landed on some other link or button in the row is that
              // control's, not the row's.
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest("a, button")) {
                  navigate(`/agents/${a.agent_id}`);
                }
              }}
            >
              <td style={{ fontWeight: 500 }}>
                <Link to={`/agents/${a.agent_id}`}>{a.name}</Link>
                {/* The id moves under the name: it is how the system refers to
                    the agent, not how its operator does, and it was taking a
                    column from the number a caller actually dials. */}
                <span className="sub">
                  <Uid id={a.agent_id} label="agent_id" />
                </span>
              </td>
              <td className="nowrap">
                {activity[a.agent_id]?.number || <span className="muted">not routed</span>}
              </td>
              <td>
                {activity[a.agent_id] ? (
                  <Ribbon
                    hours={activity[a.agent_id].hours}
                    total={activity[a.agent_id].calls_24h}
                    available={activity[a.agent_id].available}
                    truncated={activity[a.agent_id].truncated}
                  />
                ) : (
                  <span className="ribbon-empty" />
                )}
              </td>
              <td>
                <span className={`badge ${a.status}`} title={agentStatus(a.status).title}>
                  {agentStatus(a.status).label}
                </span>
              </td>
            </tr>
          ))}
          {agents === null && !error && <SkeletonRows columns={4} />}
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

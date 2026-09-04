import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { canEdit } from "../roles";
import Uid from "../components/Uid";
import { Agent, ApiResponse, PhoneNumber } from "../types";

type Num = PhoneNumber;

const ROUTING_LABELS: Record<string, string> = {
  agent: "agent",
  agent_call_init: "agent + caller info",
  webhook: "custom call-init",
  none: "unassigned",
};

export default function PhoneNumbersList() {
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role); // viewers get a read-only list
  const [numbers, setNumbers] = useState<Num[] | null>(null); // null = loading
  const [names, setNames] = useState<Record<string, string>>({}); // agent_id -> name
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [sortDesc, setSortDesc] = useState(false); // by number, ascending default

  const load = () =>
    api<ApiResponse<{ phone_numbers: Num[] }>>("/phone-numbers")
      .then((r) => setNumbers(r.data.phone_numbers))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // Resolve agent_id -> name so the Target column shows names, not UUIDs.
    api<ApiResponse<{ agents: Agent[] }>>("/agents")
      .then((r) => setNames(Object.fromEntries(r.data.agents.map((a) => [a.agent_id, a.name]))))
      .catch(() => {}); // best-effort — falls back to the id
  }, []);

  // Filter by id or number, then sort by number (e164).
  const visible = (numbers || [])
    .filter((n) => {
      const s = q.trim().toLowerCase();
      return !s || n.e164.toLowerCase().includes(s) || n.id.toLowerCase().includes(s);
    })
    .sort((a, b) => (sortDesc ? -1 : 1) * a.e164.localeCompare(b.e164));

  async function unbind(id: string) {
    if (!confirm("Unbind this number?")) return;
    setError("");
    try {
      await api(`/phone-numbers/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbind failed.");
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Phone Numbers</h2>
          <p>Twilio numbers routed to agents or call-init endpoints.</p>
        </div>
        {editable && (
          <Link to="/phone-numbers/new" className="btn btn-primary">+ Add number</Link>
        )}
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
      <input
        className="input"
        style={{ marginBottom: 10, maxWidth: 360 }}
        aria-label="Search phone numbers by id or number"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by number or id (e.g. +1415… or 3f2a…)"
      />
      <table className="list">
        <thead>
          <tr>
            <th>
              <button
                className="row-toggle"
                onClick={() => setSortDesc((v) => !v)}
                aria-label={`Sort by number, ${sortDesc ? "descending" : "ascending"} — click to reverse`}
              >
                Number <span className="caret" aria-hidden="true">{sortDesc ? "▾" : "▴"}</span>
              </button>
            </th>
            <th>ID</th><th>Routing</th><th>Target</th><th>SMS</th><th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((n) => (
            <tr key={n.id}>
              <td className="num" style={{ fontWeight: 500 }}>{n.e164}</td>
              <td><Uid id={n.id} label="phone_number_id" /></td>
              <td>{ROUTING_LABELS[n.routing_type] || n.routing_type}</td>
              <td style={{ fontSize: 12.5 }}>
                {n.agent_id ? (
                  <Link to={`/agents/${n.agent_id}`}>
                    {names[n.agent_id] || `${n.agent_id.slice(0, 8)}…`}
                  </Link>
                ) : n.routing_type === "webhook" ? (
                  <code style={{ overflowWrap: "anywhere" }}>{n.server_url}</code>
                ) : (
                  <span className="muted">unassigned</span>
                )}
              </td>
              <td>{n.sms_enabled ? "on" : <span className="muted">off</span>}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {editable && (
                  <>
                    <Link to={`/phone-numbers/${n.id}/edit`}>edit</Link>
                    <button className="btn btn-danger" style={{ marginLeft: 10, padding: "3px 10px" }} onClick={() => unbind(n.id)}>
                      remove
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {numbers === null && !error && (
            <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>Loading…</td></tr>
          )}
          {numbers?.length === 0 && (
            <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>No numbers bound yet.</td></tr>
          )}
          {numbers && numbers.length > 0 && visible.length === 0 && (
            <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>No numbers match “{q}”.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

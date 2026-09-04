import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api } from "../../api";
import Uid from "../../components/Uid";
import { VoiceCallProvider } from "./VoiceCall";
import { usePoll } from "../../usePoll";
import { Backend, ToolStatuses } from "../../types";

// Re-export so the tabs keep importing these from AgentPage.
export type { Backend, ToolStatuses };
export type AgentData = {
  agent_id: string;
  config: unknown;
  backend: Backend | null;
  tool_statuses: ToolStatuses | null;
  tool_signing_secret: string | null;
};

export type AgentCtx = {
  agentId: string;
  data: AgentData;
  setBackend: (b: Backend) => void;
  updateConfig: (c: unknown) => void;
};

export const useAgent = () => useOutletContext<AgentCtx>();

// Shared frame for the agent tabs: header (id, status, actions) + tab nav.
export default function AgentPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<AgentData | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Abort + guard so navigating A→B can't write A's data under B's URL.
    const ac = new AbortController();
    setData(null);
    setError("");
    api(`/agents/${id}`, { signal: ac.signal })
      .then((r) => {
        if (!ac.signal.aborted) setData(r.data);
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e.message);
      });
    return () => ac.abort();
  }, [id]);

  // While the backend is building (Create/Update/Start background the docker
  // build), poll for the running/failed transition so the badge updates itself.
  usePoll(
    () => api(`/agents/${id}`).then((r) => setData(r.data)).catch(() => {}),
    2000,
    data?.backend?.status === "generating"
  );

  const setBackend = useCallback(
    (backend: Backend) => setData((d) => (d ? { ...d, backend } : d)),
    []
  );
  const updateConfig = useCallback(
    (config: unknown) => setData((d) => (d ? { ...d, config } : d)),
    []
  );

  async function startBackend() {
    setMsg("");
    setBusy(true);
    try {
      const r = await api(`/agents/${id}/start`, { method: "POST" });
      setData((d) => (d && d.backend ? { ...d, backend: { ...d.backend, status: r.data.status } } : d));
      setMsg(r.data.status === "failed" ? "Start failed — see builder logs." : "Backend started.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Start failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAgent() {
    if (!confirm("Delete this agent? Its container is removed and the TurnCall agent is archived. The generated repo stays on disk.")) return;
    try {
      await api(`/agents/${id}`, { method: "DELETE" });
      nav("/agents");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  if (error) return <p role="alert" className="error-text">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const backend = data.backend;
  const name = (data.config as any)?.name;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="page-head" style={{ marginBottom: 8 }}>
        <div>
          <h2>{name || "Agent"}</h2>
          <p style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
            <Uid id={id} label="agent_id" full />
            {backend && (
              <>
                <code>:{backend.port}</code>
                <span className={`badge ${backend.status}`}>{backend.status}</span>
              </>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span aria-live="polite" className="muted" style={{ fontSize: 13 }}>{msg}</span>
          {backend?.status === "stopped" && (
            <button className="btn" onClick={startBackend} disabled={busy}>
              {busy ? "Starting…" : "Start backend"}
            </button>
          )}
          <Link className="btn" to={`/agents/${id}/edit`}>Edit in chat</Link>
          <button className="btn btn-danger" onClick={deleteAgent}>Delete</button>
        </div>
      </div>

      <nav className="tabs">
        <NavLink to="." end className={({ isActive }) => `tab${isActive ? " active" : ""}`}>Config</NavLink>
        <NavLink to="test" className={({ isActive }) => `tab${isActive ? " active" : ""}`}>Test</NavLink>
        <NavLink to="calls" className={({ isActive }) => `tab${isActive ? " active" : ""}`}>Calls</NavLink>
        <NavLink to="knowledge" className={({ isActive }) => `tab${isActive ? " active" : ""}`}>Knowledge</NavLink>
        <NavLink to="takeaways" className={({ isActive }) => `tab${isActive ? " active" : ""}`}>Takeaways</NavLink>
      </nav>

      {/* keyed by agent id so switching agents tears down any live test call */}
      <VoiceCallProvider key={id}>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Outlet context={{ agentId: id!, data, setBackend, updateConfig } satisfies AgentCtx} />
        </div>
      </VoiceCallProvider>
    </div>
  );
}

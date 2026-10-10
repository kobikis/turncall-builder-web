import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { canEdit } from "../../roles";
import Uid from "../../components/Uid";
import { VoiceCallProvider } from "./VoiceCall";
import { usePoll } from "../../usePoll";
import { Backend, ToolStatuses } from "../../types";
import { agentStatus } from "../../agentStatus";
import { dirtySections, type SectionId } from "./sections";

// Re-export so the tabs keep importing these from AgentPage.
export type { Backend, ToolStatuses };
export type AgentData = {
  agent_id: string;
  config: unknown;
  backend: Backend | null;
  tool_statuses: ToolStatuses | null;
  tool_signing_secret: string | null;
  /** TurnCall's own read of the agent, as of page load (null if unreachable). */
  turncall_agent?: { warnings?: { code: string; message: string }[] } | null;
};

export type AgentCtx = {
  agentId: string;
  data: AgentData;
  setBackend: (b: Backend) => void;
  /** The config being edited. It lives here, not in a section, so moving
   *  between sections and tabs keeps it, and the header can save it. */
  draft: any;
  patch: (fn: (c: any) => void) => void;
  setDraft: (c: any) => void;
  dirty: SectionId[];
  /** Resolves true once the draft is the saved agent. */
  save: () => Promise<boolean>;
  /** Set by the JSON editor while its text does not parse; blocks a save. */
  setJsonError: (e: string) => void;
};

export const useAgent = () => useOutletContext<AgentCtx>();

const clone = (o: unknown) => JSON.parse(JSON.stringify(o ?? {}));

// Order-insensitive custom_tools comparison — mirrors the API's regen trigger.
function toolsChanged(a: unknown, b: unknown): boolean {
  const norm = (c: any) =>
    JSON.stringify(
      ((c || {}).custom_tools || [])
        .slice()
        .sort((x: any, y: any) => String(x.name).localeCompare(String(y.name)))
    );
  return norm(a) !== norm(b);
}

const TABS = [
  ["", "Build"],
  ["calls", "Calls"],
  ["campaigns", "Campaigns"],
  ["evals", "Evals"],
  ["code", "Code"],
] as const;

// The Workbench frame: one top bar (agent, tabs, save) over whichever tab is open.
export default function AgentPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role);
  const [data, setData] = useState<AgentData | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [jsonError, setJsonError] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Abort + guard so navigating A→B can't write A's data under B's URL.
    const ac = new AbortController();
    setData(null);
    setDraft(null);
    setError("");
    api(`/agents/${id}`, { signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return;
        setData(r.data);
        setDraft(clone(r.data.config));
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e.message);
      });
    return () => ac.abort();
  }, [id]);

  // While the backend is building (Create/Update/Start background the docker
  // build), poll for the running/failed transition so the badge updates itself.
  // The draft is left alone: a poll must not throw away an edit.
  usePoll(
    () => api(`/agents/${id}`).then((r) => setData(r.data)).catch(() => {}),
    2000,
    data?.backend?.status === "generating"
  );

  const setBackend = useCallback(
    (backend: Backend) => setData((d) => (d ? { ...d, backend } : d)),
    []
  );
  // Immutable nested edit: clone, mutate the copy, set.
  const patch = useCallback(
    (fn: (c: any) => void) =>
      setDraft((c: any) => {
        const next = clone(c);
        fn(next);
        return next;
      }),
    []
  );
  const dirty = useMemo(() => (data && draft ? dirtySections(data.config, draft) : []), [data, draft]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!data) return false;
    setMsg("");
    setSaveErr("");
    if (jsonError) {
      setSaveErr(`Config is not valid JSON: ${jsonError}`);
      return false;
    }
    if (dirty.length === 0) return true;
    if (
      toolsChanged(data.config, draft) &&
      !confirm(
        "Changing tools regenerates the backend's app.py, overwriting handler edits in the generated repo.\n\nYour edits are committed to git first (recoverable with `git log`). Continue?"
      )
    )
      return false;
    setSaving(true);
    try {
      const saved = draft;
      const r = await api(`/agents/${id}`, { method: "PUT", body: JSON.stringify({ config: saved }) });
      setData((d) => (d ? { ...d, config: saved } : d));
      setMsg(
        r.data?.backend_regenerated
          ? "Saved — backend regenerated (tools changed); previous handler code is in git history."
          : "Saved."
      );
      return true;
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [data, draft, dirty, id, jsonError]);

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
  if (!data || !draft) return <p className="muted">Loading…</p>;

  const backend = data.backend;
  const name = (data.config as any)?.name;
  // "/agents/<id>/<tab>/…" — Build is the bare agent path and its sections.
  const tab = pathname.split("/")[3] ?? "";
  const active = tab === "build" ? "" : tab;

  return (
    <div className="workbench">
      <header className="wb-bar">
        <div className="wb-title">
          <Link to="/agents" className="muted">Agents</Link>
          <span aria-hidden="true" className="muted">/</span>
          <h1>{name || "Agent"}</h1>
          {backend && (
            <span className={`badge ${backend.status}`} title={agentStatus(backend.status).title}>
              {agentStatus(backend.status).label}
            </span>
          )}
        </div>
        <nav aria-label="Agent" className="seg">
          {TABS.map(([to, label]) => (
            <Link key={label} to={`/agents/${id}${to && "/" + to}`} aria-current={active === to ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="wb-actions">
          <span aria-live="polite" className="wb-status">
            {!editable ? (
              "Read-only"
            ) : dirty.length > 0 ? (
              <><span className="dot" aria-hidden="true" />{dirty.length} unsaved change{dirty.length > 1 ? "s" : ""}</>
            ) : (
              msg
            )}
          </span>
          {backend?.status === "stopped" && (
            <button className="btn" onClick={startBackend} disabled={busy}>
              {busy ? "Starting…" : "Start backend"}
            </button>
          )}
          <Link className="btn" to={`/agents/${id}/edit`}>Edit in chat</Link>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving || !editable || dirty.length === 0}>
            {saving ? "Saving…" : "Save"}
          </button>
          <details className="menu">
            <summary className="btn" aria-label="More actions">…</summary>
            <div className="menu-pop">
              <span className="muted">Agent <Uid id={id} label="agent_id" /></span>
              {backend && <span className="muted">Backend port <code>{backend.port}</code></span>}
              <button className="btn btn-danger" onClick={deleteAgent}>Delete agent</button>
            </div>
          </details>
        </div>
      </header>
      {saveErr && (
        <div className="callout error wb-error" role="alert">
          <strong>Not saved.</strong> {saveErr}
        </div>
      )}

      {/* keyed by agent id so switching agents tears down any live test call */}
      <VoiceCallProvider key={id}>
        {/* Build lays out its own panes; every other tab is one scrolling page. */}
        <div className={active ? "wb-page" : "wb-build"}>
          <Outlet
            context={{ agentId: id!, data, setBackend, draft, patch, setDraft, dirty, save, setJsonError } satisfies AgentCtx}
          />
        </div>
      </VoiceCallProvider>
    </div>
  );
}

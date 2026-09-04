import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { Backend } from "../types";

// The builder — "New agent" from the Agents list, or "Edit in chat" from an
// agent page (route param :id → edit an existing agent, grounded on its config).
type Msg = { role: "user" | "assistant"; text: string };
type Turn = {
  action: "ask" | "finalize";
  question?: string;
  agent_config?: unknown;
  pending_apply?: boolean;
};

export default function NewAgent() {
  const nav = useNavigate();
  const { id: editAgentId } = useParams<{ id?: string }>();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [notice, setNotice] = useState("");
  const [config, setConfig] = useState<string>("");
  const [saveMsg, setSaveMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [failedBackend, setFailedBackend] = useState<Backend | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");
  const [queuedDocs, setQueuedDocs] = useState<File[]>([]);
  const [docMsg, setDocMsg] = useState("");
  // Builder-model picker: which LLM drives the interview itself. Empty
  // provider = deployment default; locked once the session exists (create-only).
  const [builderProviders, setBuilderProviders] = useState<string[]>([]);
  const [builderDefault, setBuilderDefault] = useState<{ provider: string; model: string } | null>(null);
  const [builderProvider, setBuilderProvider] = useState("");
  const [builderModels, setBuilderModels] = useState<string[]>([]);
  const [builderModel, setBuilderModel] = useState("");
  const seededRef = useRef(false);
  const docsRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Upload each file to the agent's KB (auto-created + linked on first upload).
  // Returns the names that failed so the caller can surface them.
  async function uploadDocs(targetId: string, files: File[]): Promise<string[]> {
    const failed: string[] = [];
    for (const f of files) {
      try {
        const form = new FormData();
        form.append("file", f);
        await api(`/agents/${targetId}/knowledge/documents`, { method: "POST", body: form });
      } catch {
        failed.push(f.name);
      }
    }
    return failed;
  }

  // "+ Add docs": upload now if the agent exists, else queue for Create.
  async function onPickDocs(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // let the same file be re-picked
    if (!files.length) return;
    setDocMsg("");
    if (agentId) {
      setDocMsg("Uploading…");
      const failed = await uploadDocs(agentId, files);
      setDocMsg(
        failed.length
          ? `Added ${files.length - failed.length}; failed: ${failed.join(", ")}`
          : `Added ${files.length} doc${files.length > 1 ? "s" : ""} to the knowledge base.`
      );
    } else {
      setQueuedDocs((q) => [...q, ...files]);
    }
  }

  // Offer only providers builder-api holds a key for; hide the picker entirely
  // if the fetch fails (the default still works server-side).
  useEffect(() => {
    (async () => {
      try {
        const r = await api("/providers/builder");
        const names = (r.data.providers as { name: string; available: boolean }[])
          .filter((p) => p.available)
          .map((p) => p.name);
        setBuilderProviders(names);
        if (r.data.default?.provider) setBuilderDefault(r.data.default);
      } catch {
        /* picker hidden; deployment default applies */
      }
    })();
  }, []);

  async function pickBuilderProvider(p: string) {
    setBuilderProvider(p);
    setBuilderModel("");
    setBuilderModels([]);
    if (!p) return;
    try {
      const r = await api(`/providers/llm/${p}/models`);
      const models: string[] = r.data.models || [];
      setBuilderModels(models);
      if (models.length) setBuilderModel(models[0]);
    } catch {
      /* no models → choice stays incomplete → default applies */
    }
  }

  // POST /sessions body: agent binding (edit mode) + the builder choice.
  // provider+model go together or not at all — an incomplete pick means default.
  function sessionBody(): string | undefined {
    const b: Record<string, string> = {};
    if (editAgentId) b.agent_id = editAgentId;
    if (builderProvider && builderModel) {
      b.builder_provider = builderProvider;
      b.builder_model = builderModel;
    }
    return Object.keys(b).length ? JSON.stringify(b) : undefined;
  }

  // Editing an existing agent: seed a session bound to it so the builder edits
  // its current config rather than building from scratch. Guard StrictMode's
  // double-mount so we don't create two sessions.
  useEffect(() => {
    if (!editAgentId || seededRef.current) return;
    seededRef.current = true;
    (async () => {
      try {
        const s = await api("/sessions", {
          method: "POST",
          body: sessionBody(),
        });
        setSessionId(s.data.session_id);
        setAgentId(editAgentId);
        if (s.data.config) setConfig(JSON.stringify(s.data.config, null, 2));
        // The edit session inherits the Builder model that created the agent —
        // reflect it in the (locked) picker so the user sees what's driving it.
        if (s.data.builder_provider && s.data.builder_model) {
          setBuilderProvider(s.data.builder_provider);
          setBuilderModels([s.data.builder_model]);
          setBuilderModel(s.data.builder_model);
        }
        setMsgs([{ role: "assistant", text: "Editing this agent. Tell me what to change." }]);
      } catch (e) {
        setChatError(e instanceof Error ? e.message : "Couldn't open this agent for editing.");
      }
    })();
  }, [editAgentId]);

  // Create the builder session lazily on first send — a mount effect
  // double-creates under StrictMode and leaks the extra (never deleted) session.
  // When editing, bind the (re)created session to the agent so grounding holds.
  async function ensureSession(): Promise<string | null> {
    if (sessionId) return sessionId;
    try {
      const s = await api("/sessions", {
        method: "POST",
        body: sessionBody(),
      });
      setSessionId(s.data.session_id);
      return s.data.session_id;
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Couldn't start a session.");
      return null;
    }
  }

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [msgs, busy]);

  async function send() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setChatError("");
    setBusy(true);
    try {
      let sid = await ensureSession();
      if (!sid) {
        setInput(text);
        return;
      }
      let r;
      try {
        r = await api(`/sessions/${sid}/messages`, {
          method: "POST",
          body: JSON.stringify({ message: text, doc_names: queuedDocs.map((f) => f.name) }),
        });
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
        // Session expired server-side: start fresh and say so — the builder
        // no longer remembers anything before this message. Re-bind to the agent
        // when editing so it keeps grounding on the live config.
        const s = await api("/sessions", {
          method: "POST",
          body: sessionBody(),
        });
        sid = s.data.session_id;
        setSessionId(sid);
        setNotice("The builder session expired — started a new one. Earlier answers were lost; this message begins a fresh conversation.");
        r = await api(`/sessions/${sid}/messages`, {
          method: "POST",
          body: JSON.stringify({ message: text, doc_names: queuedDocs.map((f) => f.name) }),
        });
      }
      const turn: Turn = r.data;
      if (turn.action === "ask") {
        setMsgs((m) => [...m, { role: "assistant", text: turn.question || "" }]);
      } else {
        setConfig(JSON.stringify(turn.agent_config, null, 2));
        if (turn.pending_apply) {
          // Generated agent: the change is a proposal — Apply pushes it live.
          setPending(true);
          setApplyMsg("");
          setMsgs((m) => [...m, { role: "assistant", text: "Proposed changes → review, then Apply to push them live." }]);
        } else {
          setMsgs((m) => [...m, { role: "assistant", text: "Finalized the configuration →" }]);
        }
      }
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Something went wrong — please retry.");
      setInput(text); // give the message back so a retry is one keypress
    } finally {
      setBusy(false);
    }
  }

  function parseConfig(): unknown | null {
    try {
      return JSON.parse(config);
    } catch (e) {
      setSaveMsg(`Config is not valid JSON: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  async function saveConfig(): Promise<boolean> {
    if (!sessionId) return false;
    setSaveMsg("");
    const parsed = parseConfig();
    if (parsed === null) return false;
    try {
      await api(`/sessions/${sessionId}/config`, {
        method: "PUT",
        body: JSON.stringify({ config: parsed }),
      });
      setSaveMsg("Saved.");
      return true;
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed.");
      return false;
    }
  }

  async function createAgent() {
    if (!sessionId || creating || agentId) return;
    setCreateError("");
    setFailedBackend(null);
    if (!(await saveConfig())) return;
    setCreating(true);
    try {
      const r = await api(`/sessions/${sessionId}/create`, { method: "POST" });
      const newId: string = r.data.agent_id;
      setAgentId(newId);
      const backend: Backend | null = r.data.backend;
      if (backend && backend.status === "failed") {
        setFailedBackend(backend);
        setCreateError("The agent was created, but its backend failed to start.");
        return;
      }
      // Upload any docs queued during the build, now that the agent (and its KB)
      // can exist. The agent is created regardless — a failed doc is reported,
      // never rolled back; the user can retry from the Knowledge tab.
      if (queuedDocs.length) {
        setDocMsg(`Uploading ${queuedDocs.length} doc(s)…`);
        const failed = await uploadDocs(newId, queuedDocs);
        setQueuedDocs([]);
        if (failed.length) {
          setCreateError(`Agent created, but these docs failed to upload: ${failed.join(", ")}. Retry from the Knowledge tab.`);
          return;
        }
      }
      nav(`/agents/${newId}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Create failed.");
    } finally {
      setCreating(false);
    }
  }

  // Confirm-first: push the session's edited config to the already-generated
  // agent (updates TurnCall; rebuilds the backend only if its tools changed).
  async function applyEdit() {
    if (!sessionId || creating) return;
    setApplyMsg("");
    if (!(await saveConfig())) return;
    setCreating(true);
    try {
      const r = await api(`/sessions/${sessionId}/apply`, { method: "POST" });
      setPending(false);
      setApplyMsg(
        r.data.backend_regenerated ? "Applied — rebuilding the backend…" : "Applied."
      );
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : "Apply failed.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 20, height: "100%", minHeight: 0 }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <h3>Describe your agent</h3>
        {notice && <p className="callout warn">{notice}</p>}
        <div ref={chatRef} className="chat">
          {msgs.map((m, i) => (
            <div key={i} className={`row ${m.role}`}>
              <span className="bubble">{m.text}</span>
            </div>
          ))}
          {busy && <p className="muted">…</p>}
          {chatError && <p role="alert" className="error-text">{chatError}</p>}
        </div>
        {(queuedDocs.length > 0 || docMsg) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 10 }}>
            {queuedDocs.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5,
                  padding: "3px 6px 3px 10px", borderRadius: 14,
                  background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                {f.name}
                <button
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setQueuedDocs((q) => q.filter((_, j) => j !== i))}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, fontSize: 13 }}
                >
                  ✕
                </button>
              </span>
            ))}
            {docMsg && <span aria-live="polite" className="muted" style={{ fontSize: 12.5 }}>{docMsg}</span>}
          </div>
        )}
        {builderProviders.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label htmlFor="builder-provider" className="muted" style={{ fontSize: 12.5, flex: "0 0 auto" }}>
              Builder model
            </label>
            {/* .input is width:100% — override so the two selects share the row */}
            <select
              id="builder-provider"
              className="input"
              style={{ width: "auto", flex: "0 0 auto" }}
              value={builderProvider}
              disabled={!!sessionId}
              title={sessionId ? "Locked for this session — start a new one to change it" : undefined}
              onChange={(e) => pickBuilderProvider(e.target.value)}
            >
              <option value="">
                {builderDefault ? `Default — ${builderDefault.provider} / ${builderDefault.model}` : "Default"}
              </option>
              {builderProviders.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {builderProvider && (
              <select
                aria-label="Builder model id"
                className="input"
                style={{ width: "auto", flex: "1 1 180px", minWidth: 140, maxWidth: 340 }}
                value={builderModel}
                disabled={!!sessionId || builderModels.length === 0}
                onChange={(e) => setBuilderModel(e.target.value)}
              >
                {builderModels.length === 0 && <option value="">Loading models…</option>}
                {builderModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <input ref={docsRef} type="file" multiple style={{ display: "none" }} onChange={onPickDocs} aria-hidden="true" />
          <button
            onClick={() => docsRef.current?.click()}
            disabled={creating}
            aria-label="Add documents to the knowledge base"
            title={agentId ? "Add docs to the knowledge base" : "Attach docs (uploaded when you Create)"}
            style={{
              flex: "0 0 auto", width: 38, height: 38, borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.18)", background: "transparent",
              color: "inherit", fontSize: 22, lineHeight: 1, cursor: creating ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            +
          </button>
          <input
            className="input"
            style={{ flex: 1 }}
            aria-label="Describe your agent"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
            }}
            placeholder="e.g. a clinic receptionist that books and cancels appointments"
          />
          <button className="btn btn-primary" onClick={send} disabled={busy}>Send</button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <h3 id="config-label">Agent configuration</h3>
        <textarea
          className="input code"
          style={{ flex: 1 }}
          aria-labelledby="config-label"
          value={config}
          onChange={(e) => setConfig(e.target.value)}
          placeholder="Appears when the builder finalizes. Editable."
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
          <button className="btn" onClick={saveConfig} disabled={!config || creating}>Save edits</button>
          {agentId ? (
            <button className="btn btn-primary" onClick={applyEdit} disabled={!config || creating}>
              {creating ? "Applying…" : "Apply to live agent"}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={createAgent} disabled={!config || creating}>
              {creating ? "Creating…" : "Create in TurnCall"}
            </button>
          )}
          <span aria-live="polite" className="muted" style={{ fontSize: 13 }}>{saveMsg}</span>
        </div>
        {(pending || applyMsg) && (
          <p aria-live="polite" className={`callout ${pending ? "warn" : ""}`} style={{ fontSize: 13 }}>
            {applyMsg || "Chat proposed changes — Apply to push them to the live agent."}
          </p>
        )}
        {createError && (
          <div role="alert" className="callout error">
            <strong>{createError}</strong>
            {agentId && (
              <p>
                You can inspect it on <Link to={`/agents/${agentId}`}>the agent page</Link>.
              </p>
            )}
            {failedBackend?.logs && <pre>{failedBackend.logs}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}

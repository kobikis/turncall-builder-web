import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { parseHeaders } from "../agent/McpServers";

// Workspace MCP servers (ADR-0023, #47): registered once here, opted into per
// agent on its Configuration tab. Headers carry bearer tokens, so they are
// write-only — a saved server shows which headers it has, never their values.

export type RegisteredServer = {
  id: string;
  name: string;
  transport: string;
  url: string;
  header_names: string[];
  agents?: string[];
};

const TRANSPORTS = ["http", "sse"] as const; // stdio is refused (ADR-0017)

type Draft = { name: string; transport: string; url: string; headers: string };
const EMPTY: Draft = { name: "", transport: "http", url: "", headers: "" };

export function McpRegistry({ isAdmin }: { isAdmin: boolean }) {
  const [servers, setServers] = useState<RegisteredServer[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      api("/integrations/mcp-servers")
        .then((r) => setServers(Array.isArray(r.data) ? r.data : []))
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load MCP servers.")),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    // On an edit, blank headers keep the stored ones (they cannot be shown to
    // be edited); on a new server, blank means none.
    const headers = draft.headers.trim() ? parseHeaders(draft.headers) : editing ? null : {};
    try {
      await api(editing ? `/integrations/mcp-servers/${editing}` : "/integrations/mcp-servers", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({ name: draft.name, transport: draft.transport, url: draft.url, headers }),
      });
      setDraft(null);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the server.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await api(`/integrations/mcp-servers/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="mcp-registry" className="int-section">
      <h3 id="mcp-registry">MCP servers</h3>
      <p className="lead">
        Register a tool server once for the workspace; each agent opts in on its
        Configuration tab. Nothing is inherited.
      </p>
      {error && (
        <div className="callout error" role="alert">
          {error}
        </div>
      )}
      {servers.length === 0 && <p className="muted">No servers registered.</p>}
      {servers.length > 0 && (
      <ul className="mcp-list">
        {servers.map((s) => (
          <li key={s.id} data-testid={`mcp-${s.name}`}>
            <div className="mcp-main">
              <strong>{s.name}</strong>
              <span className="muted">
                {s.transport} · {s.url}
                {s.header_names.length > 0 && <> · headers: {s.header_names.join(", ")}</>}
                {" "}· {(s.agents || []).length} agent(s)
              </span>
            </div>
            {isAdmin && (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setEditing(s.id);
                    setDraft({ name: s.name, transport: s.transport, url: s.url, headers: "" });
                  }}
                >
                  Edit
                </button>{" "}
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove(s.id)}>
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      )}
      {isAdmin && !draft && (
        <button type="button" className="btn" onClick={() => setDraft(EMPTY)}>
          Register a server
        </button>
      )}
      {isAdmin && draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          style={{ maxWidth: 520 }}
        >
          <div className="field">
            <label htmlFor="mcp-reg-name">Name</label>
            <input
              id="mcp-reg-name"
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="crm"
            />
          </div>
          <div className="field">
            <label htmlFor="mcp-reg-transport">Transport</label>
            <select
              id="mcp-reg-transport"
              className="input"
              value={draft.transport}
              onChange={(e) => setDraft({ ...draft, transport: e.target.value })}
            >
              {TRANSPORTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="mcp-reg-url">URL</label>
            <input
              id="mcp-reg-url"
              className="input"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="https://mcp.example.com/mcp"
            />
          </div>
          <div className="field">
            <label htmlFor="mcp-reg-headers">Headers</label>
            <textarea
              id="mcp-reg-headers"
              className="input"
              rows={2}
              autoComplete="off"
              value={draft.headers}
              onChange={(e) => setDraft({ ...draft, headers: e.target.value })}
              placeholder={editing ? "Leave blank to keep the saved headers" : "Authorization: Bearer …"}
            />
            <p className="hint" style={{ margin: "4px 0 0" }}>
              Stored encrypted and never shown again.
            </p>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.name || !draft.url}>
            {editing ? "Save changes" : "Register"}
          </button>{" "}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(null);
              setEditing(null);
            }}
          >
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}

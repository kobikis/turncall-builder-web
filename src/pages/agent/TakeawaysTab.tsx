import { useEffect, useState } from "react";
import { api } from "../../api";
import Uid from "../../components/Uid";
import { useAgent } from "./AgentPage";
import { Takeaway } from "../../types";


const EXAMPLE_SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: {
      score: { type: "integer", minimum: 1, maximum: 5 },
      reason: { type: "string" },
    },
    required: ["score"],
  },
  null,
  2
);

type FormState = {
  name: string;
  description: string;
  prompt: string;
  model: string;
  schema: string;
};

const emptyForm: FormState = { name: "", description: "", prompt: "", model: "", schema: EXAMPLE_SCHEMA };

function TakeawayForm(props: {
  initial?: Takeaway;
  busy: boolean;
  onSubmit: (body: any) => void;
  onCancel: () => void;
}) {
  const editing = !!props.initial;
  const [f, setF] = useState<FormState>(
    props.initial
      ? {
          name: props.initial.name,
          description: props.initial.description || "",
          prompt: props.initial.prompt || "",
          model: props.initial.model || "",
          schema: JSON.stringify(props.initial.schema, null, 2),
        }
      : emptyForm
  );
  const [err, setErr] = useState("");

  function submit() {
    setErr("");
    if (!editing && !/^[a-z0-9][a-z0-9_-]*$/.test(f.name)) {
      setErr("Name must be identifier-shaped: lowercase letters, digits, _ or - (e.g. csat_score). It keys the result in call payloads.");
      return;
    }
    let schema: unknown;
    try {
      schema = JSON.parse(f.schema);
    } catch (e) {
      setErr(`Schema is not valid JSON: ${e instanceof Error ? e.message : e}`);
      return;
    }
    props.onSubmit({
      ...(editing ? {} : { name: f.name }),
      description: f.description || null,
      prompt: f.prompt || null,
      model: f.model || null,
      schema,
    });
  }

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <h3>{editing ? `Edit ${props.initial!.name}` : "New takeaway"}</h3>
      {!editing && (
        <div className="field">
          <label htmlFor="tk-name">Name</label>
          <input id="tk-name" className="input" value={f.name} autoComplete="off" spellCheck={false}
            onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="csat_score" />
          <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
            Keys the result in call payloads — immutable after creation.
          </p>
        </div>
      )}
      <div className="field">
        <label htmlFor="tk-desc">Description</label>
        <input id="tk-desc" className="input" value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="Customer satisfaction, inferred from the conversation" />
      </div>
      <div className="field">
        <label htmlFor="tk-prompt">Extraction prompt (optional)</label>
        <textarea id="tk-prompt" className="input" rows={3} value={f.prompt}
          onChange={(e) => setF({ ...f, prompt: e.target.value })}
          placeholder="Extra instructions for the extractor, e.g. 'Score conservatively; only 5 when the caller explicitly praises.'" />
      </div>
      <div className="field">
        <label htmlFor="tk-schema">JSON Schema</label>
        <textarea id="tk-schema" className="input code" rows={10} value={f.schema}
          onChange={(e) => setF({ ...f, schema: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="tk-model">Model override (optional)</label>
        <input id="tk-model" className="input" value={f.model} autoComplete="off" spellCheck={false}
          onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="gpt-4o-mini" />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn btn-primary" onClick={submit} disabled={props.busy}>
          {props.busy ? "Saving…" : editing ? "Save" : "Create"}
        </button>
        <button className="btn" onClick={props.onCancel} disabled={props.busy}>Cancel</button>
      </div>
      {err && <p role="alert" className="error-text">{err}</p>}
    </div>
  );
}

export default function TakeawaysTab() {
  const { agentId } = useAgent();
  const [takeaways, setTakeaways] = useState<Takeaway[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Takeaway | null>(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [sortDesc, setSortDesc] = useState(false); // by name, ascending default

  const load = () =>
    api(`/agents/${agentId}/takeaways`)
      .then((r) => setTakeaways(r.data.takeaways))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [agentId]);

  // Filter by name or id, then sort by name.
  const visible = (takeaways || [])
    .filter((t) => {
      const s = q.trim().toLowerCase();
      return !s || t.name.toLowerCase().includes(s) || t.id.toLowerCase().includes(s);
    })
    .sort((a, b) => (sortDesc ? -1 : 1) * a.name.localeCompare(b.name));

  async function create(body: any) {
    setBusy(true);
    setError("");
    try {
      await api(`/agents/${agentId}/takeaways`, { method: "POST", body: JSON.stringify(body) });
      setCreating(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  async function update(id: string, body: any) {
    setBusy(true);
    setError("");
    try {
      await api(`/agents/${agentId}/takeaways/${id}`, { method: "PUT", body: JSON.stringify(body) });
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: Takeaway) {
    if (!confirm(`Delete takeaway "${t.name}"? Future calls stop extracting it (past results are kept on their calls).`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/agents/${agentId}/takeaways/${t.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, overflowY: "auto" }}>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0 }}>
          Structured data extracted from every call — results appear per call in the
          Calls tab and in <code>call.ended</code> under <code>analysis.takeaways</code>.
        </p>
        {!creating && !editing && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New takeaway</button>
        )}
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
      <input
        className="input"
        style={{ marginBottom: 10, maxWidth: 360 }}
        aria-label="Search takeaways by name or id"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or id"
      />

      {creating && <TakeawayForm busy={busy} onSubmit={create} onCancel={() => setCreating(false)} />}
      {editing && (
        <TakeawayForm initial={editing} busy={busy} onSubmit={(b) => update(editing.id, b)} onCancel={() => setEditing(null)} />
      )}

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
            <th>ID</th><th>Description</th><th>Model</th><th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((t) => (
            <tr key={t.id}>
              <td><code>{t.name}</code></td>
              <td><Uid id={t.id} label="takeaway_id" /></td>
              <td className="muted" style={{ overflowWrap: "anywhere" }}>{t.description || "—"}</td>
              <td>{t.model || <span className="muted">analysis default</span>}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button className="btn" style={{ padding: "3px 10px" }} disabled={busy} onClick={() => { setCreating(false); setEditing(t); }}>
                  edit
                </button>
                <button className="btn btn-danger" style={{ padding: "3px 10px", marginLeft: 8 }} disabled={busy} onClick={() => remove(t)}>
                  delete
                </button>
              </td>
            </tr>
          ))}
          {takeaways === null && !error && (
            <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>Loading…</td></tr>
          )}
          {takeaways?.length === 0 && !creating && (
            <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>
              No takeaways yet — define what each call should be distilled into (CSAT, lead fields, booking details).
            </td></tr>
          )}
          {takeaways && takeaways.length > 0 && visible.length === 0 && (
            <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>No takeaways match “{q}”.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

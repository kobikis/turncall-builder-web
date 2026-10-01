import { useEffect, useState } from "react";
import { api } from "../api";

// The workspace's own Builder skills (ADR-0015). A skill teaches the builder how
// to build a kind of agent — it is guidance, not configuration: it only loads
// when the model judges it applies, so it must not be used to pin a default.

type Skill = { name: string; description: string; body: string; updated_at: string };

const BLANK = { name: "", description: "", body: "" };

export default function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [reserved, setReserved] = useState<string[]>([]);
  const [form, setForm] = useState(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false); // the add/edit dialog

  const load = () =>
    api("/skills").then((r) => {
      setSkills(r.data.skills);
      setReserved(r.data.reserved);
    });

  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await api(`/skills/${encodeURIComponent(form.name.trim())}`, {
        method: "PUT",
        body: JSON.stringify({ description: form.description, body: form.body }),
      });
      await load();
      setNotice(
        `Saved. It applies from the next message of every conversation, including ones already open.`
      );
      setForm(BLANK);
      setEditing(null);
      setOpen(false);
    });

  const edit = (s: Skill) => {
    setForm({ name: s.name, description: s.description, body: s.body });
    setEditing(s.name);
    setError("");
    setNotice("");
  };

  const remove = (name: string) =>
    run(async () => {
      await api(`/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
      await load();
      if (editing === name) {
        setForm(BLANK);
        setEditing(null);
      }
      setNotice(`Removed ${name}.`);
    });

  const complete = form.name.trim() && form.description.trim() && form.body.trim();
  const close = () => {
    setOpen(false);
    setForm(BLANK);
    setEditing(null);
    setError("");
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Skills</h2>
          <p>Guidance the builder reads when the agent it is building matches a skill's description.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setForm(BLANK);
            setEditing(null);
            setNotice("");
            setOpen(true);
          }}
        >
          + New skill
        </button>
      </div>

      {notice && !open && <div className="callout info" role="status">{notice}</div>}
      {error && !open && <p role="alert" className="error-text">{error}</p>}

      <table className="list">
        <thead>
          <tr>
            <th>Name</th>
            <th>When the builder uses it</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => (
            <tr key={s.name}>
              <td className="num" style={{ fontWeight: 500, whiteSpace: "nowrap" }}>
                <button className="link-button" onClick={() => { edit(s); setOpen(true); }}>
                  {s.name}
                </button>
              </td>
              <td className="hint">{s.description}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button
                  className="btn"
                  style={{ padding: "3px 10px", marginRight: 6 }}
                  disabled={busy}
                  onClick={() => { edit(s); setOpen(true); }}
                >
                  edit
                </button>
                <button
                  className="btn btn-danger"
                  style={{ padding: "3px 10px" }}
                  disabled={busy}
                  onClick={() => remove(s.name)}
                >
                  delete
                </button>
              </td>
            </tr>
          ))}
          {skills.length === 0 && (
            <tr>
              <td colSpan={3} className="muted" style={{ padding: 16 }}>
                No skills yet. The built-in skills still apply.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 10 }}>
        Built-in skills: {reserved.join(", ") || "—"}. Their names are taken.
      </p>

      {open && (
        <div className="modal-backdrop" onClick={() => !busy && close()}>
          <div
            className="modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? `Edit ${editing}` : "New skill"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div className="title">
                <div className="name">{editing ? `Edit ${editing}` : "New skill"}</div>
                <div className="roles">
                  Teaches the builder how to decide, not what to pick — it is read only
                  when it looks relevant, so it is the wrong place for "always use this voice".
                </div>
              </div>
              <button type="button" className="modal-close" aria-label="Close" onClick={close}>
                ×
              </button>
            </div>

            <div className="field">
              <label htmlFor="sk-name">Name</label>
              <input
                id="sk-name"
                className="input"
                placeholder="restaurant-reservations"
                value={form.name}
                disabled={busy || editing !== null}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <p className="hint" style={{ margin: "4px 0 0" }}>
                Lowercase words joined by hyphens. Taken by built-in skills:{" "}
                {reserved.join(", ") || "—"}.
              </p>
            </div>

            <div className="field">
              <label htmlFor="sk-when">When should the builder use this?</label>
              <textarea
                id="sk-when"
                className="input"
                rows={2}
                placeholder="Use when building an agent that takes table bookings — covers party size, seating preferences, waitlists and no-shows."
                value={form.description}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
              <p className="hint" style={{ margin: "4px 0 0" }}>
                The one part the builder always sees — a vague line means the skill is never opened.
              </p>
            </div>

            <div className="field">
              <label htmlFor="sk-body">Instructions</label>
              <textarea
                id="sk-body"
                className="input"
                rows={12}
                placeholder={"# Taking a booking\n\nAsk for covers before time — the time you can offer depends on it.\nNever read options as a numbered list; the caller cannot skim."}
                value={form.body}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              />
              <p className="hint" style={{ margin: "4px 0 0" }}>
                Markdown. Write it as instructions to the builder.
              </p>
            </div>

            {error && <p role="alert" className="error-text">{error}</p>}

            <div className="modal-actions">
              <button type="button" className="btn" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy || !complete} onClick={save}>
                {editing ? `Save ${editing}` : "Add skill"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

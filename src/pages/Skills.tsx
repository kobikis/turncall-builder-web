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

  return (
    <section>
      <h2>Skills</h2>
      <p className="muted" style={{ fontSize: 13, maxWidth: 680 }}>
        A skill teaches the builder how to build a kind of agent — how you take a
        table booking, what your dispatchers need before a job goes out. It reads
        one when the work matches its description, alongside the ones that ship
        with TurnCall.
      </p>
      <p className="muted" style={{ fontSize: 13, maxWidth: 680 }}>
        A skill teaches the builder <strong>how to decide</strong>, not what to
        pick. It is read only when it looks relevant, so it is the wrong place
        for “always use this voice” — that would apply most of the time, which is
        worse than never.
      </p>

      <div className="card" style={{ maxWidth: 680 }}>
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
            Lowercase words joined by hyphens. These names are taken by built-in
            skills: {reserved.join(", ") || "—"}.
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
            The one part the builder always sees. Everything below is read only
            once this line matches what it is doing — so a vague line here means
            the skill is never opened, however good it is.
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
        {notice && !error && <p className="muted">{notice}</p>}

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn primary" disabled={busy || !complete} onClick={save}>
            {editing ? `Save ${editing}` : "Add skill"}
          </button>
          {editing && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setForm(BLANK);
                setEditing(null);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <h3 style={{ marginTop: 24 }}>This workspace's skills</h3>
      {skills.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          None yet. The built-in skills still apply.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 10, maxWidth: 680 }}>
          {skills.map((s) => (
            <div key={s.name} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong>{s.name}</strong>
                <span style={{ display: "flex", gap: 8 }}>
                  <button className="btn" disabled={busy} onClick={() => edit(s)}>
                    Edit
                  </button>
                  <button className="btn" disabled={busy} onClick={() => remove(s.name)}>
                    Delete
                  </button>
                </span>
              </div>
              <p className="hint" style={{ margin: "6px 0 0" }}>
                {s.description}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

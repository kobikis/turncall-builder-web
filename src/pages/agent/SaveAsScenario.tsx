import { useState } from "react";
import { api } from "../../api";

// "Save as scenario": turn a call that already happened into an eval scenario
// (builder-api #41, turncall#78).
//
// Nobody sits down to author test cases for a voice agent. They do click a
// button on a call that went wrong — which is the whole reason this exists and
// why the Evals tab's empty state points here.
//
// The rule that governs every line below: **what comes back is a draft, not a
// test.** TurnCall captures the conversation faithfully — the caller's turns,
// the agent's replies as expectations, and each tool the agent called seeded as
// a mock with the response it actually returned — but it asserts whatever the
// agent did on that call, *including the mistake that made you click the
// button*. Saving one unread produces a test that goes green forever while
// checking the wrong thing, which is worse than having no test.
//
// So: derive with `save: false`, show it, let it be edited, and store only what
// a person approved. The save is a plain scenario create, not a second derive,
// so what is stored is exactly what was on screen.

type Draft = {
  name: string;
  definition: Record<string, unknown>;
  tool_mocks: Record<string, unknown>;
  tool_policy: string;
  note: string;
};

export default function SaveAsScenario({
  agentId,
  callId,
  onSaved,
}: {
  agentId: string;
  callId: string;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function derive() {
    setError("");
    setBusy(true);
    try {
      const r = await api(`/agents/${agentId}/eval-scenarios/from-call`, {
        method: "POST",
        body: JSON.stringify({ call_id: callId, save: false }),
      });
      setDraft(r.data);
      setName(r.data.name);
      setDefinition(JSON.stringify(r.data.definition, null, 2));
    } catch (e) {
      // TurnCall's refusals say what to do about them — "convert it once it has
      // ended", "the call has no caller speech to build turns from" — so they
      // are shown as they arrive rather than replaced with a generic failure.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(definition);
    } catch (e) {
      setError(`The scenario is not valid JSON: ${e instanceof Error ? e.message : e}`);
      return;
    }
    setBusy(true);
    try {
      await api(`/agents/${agentId}/eval-scenarios`, {
        method: "POST",
        body: JSON.stringify({
          name,
          definition: parsed,
          tool_mocks: draft!.tool_mocks,
          tool_policy: draft!.tool_policy,
          tags: ["from-call"],
        }),
      });
      setSaved(true);
      setDraft(null);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (saved)
    return (
      <p className="ok" style={{ margin: "8px 0" }}>
        Saved. It appears on the Evals tab — trim the expectations before trusting a green run.
      </p>
    );

  if (!draft)
    return (
      <div style={{ margin: "8px 0" }}>
        <button className="btn btn-sm" onClick={derive} disabled={busy}>
          {busy ? "Reading the call…" : "Save as scenario"}
        </button>
        {error && (
          <p role="alert" className="error-text" style={{ margin: "6px 0 0" }}>
            {error}
          </p>
        )}
      </div>
    );

  const mocks = Object.entries(draft.tool_mocks);
  return (
    <div className="card" style={{ padding: 16, margin: "8px 0" }}>
      <h3 style={{ marginTop: 0 }}>Review before saving</h3>
      {/* TurnCall's own wording, not a gentler paraphrase: it says the
          conversation is faithful and the expectations are a draft to trim. */}
      <p className="muted" style={{ marginTop: 0 }}>{draft.note}</p>

      <div className="field">
        <label htmlFor="sc-name">Name</label>
        <input
          id="sc-name"
          className="input"
          value={name}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="sc-def">Turns and expectations</label>
        <textarea
          id="sc-def"
          className="input code"
          rows={14}
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
        />
        <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
          Each <code>text_contains</code> currently holds everything the agent
          said. Cut it down to the part that actually matters, or the scenario
          will fail on any rewording.
        </p>
      </div>

      <div className="field">
        <label>Tool mocks</label>
        {mocks.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            The agent called no tools on this call.
          </p>
        )}
        {mocks.length > 0 && (
          <>
            <p className="muted" style={{ fontSize: 12.5, margin: "0 0 4px" }}>
              What each tool returned on the call, and what it will return on a
              rerun — so running this scenario cannot repeat the call's side
              effects.
            </p>
            <table className="table">
              <tbody>
                {mocks.map(([tool, response]) => (
                  <tr key={tool}>
                    <td><code>{tool}</code></td>
                    <td className="muted">{JSON.stringify(response)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save scenario"}
        </button>
        <button className="btn" onClick={() => setDraft(null)} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="error-text" style={{ margin: "6px 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}

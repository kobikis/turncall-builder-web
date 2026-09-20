import { useState } from "react";
import { api } from "../../api";

// Editing a saved scenario (#20).
//
// The case this exists for: a scenario derived from a call arrives with every
// `text_contains` holding the agent's entire reply, and the moment you most
// want to trim it is *after* watching it fail on a rewording — not at the
// instant you saved it. Without this the Console can create scenarios it
// cannot subsequently fix.
//
// Deliberately the same JSON editor the review step uses rather than a second
// one: pipecat owns the turn mapping's shape, and a form that renders it would
// have to be kept in step with a library we do not own. The trade is that this
// asks the reader to edit JSON — acceptable for trimming a string, worth
// revisiting if people start writing scenarios here from scratch.

export type EditableScenario = {
  id: string;
  name: string;
  tags: string[];
  definition: Record<string, unknown>;
  tool_mocks?: Record<string, unknown>;
};

export default function ScenarioEditor({
  agentId,
  scenario,
  onSaved,
  onCancel,
}: {
  agentId: string;
  scenario: EditableScenario;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(scenario.name);
  const [tags, setTags] = useState(scenario.tags.join(", "));
  const [definition, setDefinition] = useState(
    JSON.stringify(scenario.definition, null, 2)
  );
  const [mocks, setMocks] = useState(
    JSON.stringify(scenario.tool_mocks || {}, null, 2)
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setError("");
    let parsedDefinition: unknown;
    let parsedMocks: unknown;
    // Parsed before anything is sent: a malformed edit should cost a message,
    // not a round trip and a server error.
    try {
      parsedDefinition = JSON.parse(definition);
    } catch (e) {
      setError(`Turns and expectations: not valid JSON — ${e instanceof Error ? e.message : e}`);
      return;
    }
    try {
      parsedMocks = JSON.parse(mocks);
    } catch (e) {
      setError(`Tool mocks: not valid JSON — ${e instanceof Error ? e.message : e}`);
      return;
    }

    setBusy(true);
    try {
      await api(`/agents/${agentId}/eval-scenarios/${scenario.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          definition: parsedDefinition,
          tool_mocks: parsedMocks,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      onSaved();
    } catch (e) {
      // TurnCall names the offending field when it rejects a definition, and
      // that message survives the proxy now (builder-api#44). It is the whole
      // value of the response to whoever is fixing the scenario.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Edit {scenario.name}</h3>

      <div className="field">
        <label htmlFor="ed-name">Name</label>
        <input
          id="ed-name"
          className="input"
          value={name}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="ed-tags">Tags</label>
        <input
          id="ed-tags"
          className="input"
          value={tags}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setTags(e.target.value)}
          placeholder="pre-publish, from-call"
        />
        <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
          Comma separated. Running a whole tag at once is how a pre-publish set
          gets one verdict.
        </p>
      </div>

      <div className="field">
        <label htmlFor="ed-def">Turns and expectations</label>
        <textarea
          id="ed-def"
          className="input code"
          rows={16}
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
        />
        <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
          Trim each <code>text_contains</code> to the part that actually
          matters — a scenario asserting a whole reply fails on any rewording.
        </p>
      </div>

      <div className="field">
        <label htmlFor="ed-mocks">Tool mocks</label>
        <textarea
          id="ed-mocks"
          className="input code"
          rows={6}
          value={mocks}
          onChange={(e) => setMocks(e.target.value)}
        />
        <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
          What each tool returns on a rerun. A mock that has drifted from what
          the real tool now returns leaves the scenario passing while proving
          nothing.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn" onClick={onCancel} disabled={busy}>
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

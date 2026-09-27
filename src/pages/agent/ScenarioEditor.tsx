import { useState } from "react";
import { api } from "../../api";
import { INHERIT, OTHER, PROVIDERS, takesTemperature, type JudgeBlock } from "./judge";

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
  // Null (or absent) means this scenario names no judge and takes whatever the
  // platform runs — which is a different statement from "ollama", and the form
  // keeps the two apart.
  judge?: JudgeBlock | null;
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
  const [provider, setProvider] = useState(scenario.judge?.provider || INHERIT);
  const [judgeModel, setJudgeModel] = useState(scenario.judge?.model || "");
  const [temperature, setTemperature] = useState(
    scenario.judge?.temperature === null || scenario.judge?.temperature === undefined
      ? ""
      : String(scenario.judge.temperature)
  );
  const warm = provider !== INHERIT && takesTemperature(provider, judgeModel);
  const known = PROVIDERS.find((p) => p.id === provider)?.models || [];
  // A model this provider does not list is still a real answer, so the field
  // opens as a text box for one — and stays one, rather than snapping back to a
  // select that cannot represent what is in it.
  const [typing, setTyping] = useState(
    !!scenario.judge?.model && !known.includes(scenario.judge.model)
  );

  // A model name belongs to one provider, so it cannot survive a change of
  // provider: openai/`gpt-4o` switched to Anthropic sent `gpt-4o` to Claude,
  // which answers 404, and to Jev, which has one pinned model and no `gpt-4o`.
  // The run failed with a provider error and the form still showed a model the
  // author had deliberately chosen, so nothing pointed at the leftover.
  //
  // The temperature is left alone on purpose: a number is not provider-specific
  // the way a name is, and `judgeBlock` already withholds one the chosen model
  // would reject.
  function changeProvider(next: string) {
    if (next !== provider) {
      setJudgeModel("");
      setTyping(false);
    }
    setProvider(next);
  }

  function judgeBlock(): JudgeBlock | null {
    if (provider === INHERIT) return null;
    const block: JudgeBlock = { provider };
    if (judgeModel.trim()) block.model = judgeModel.trim();
    // Only when the model takes one. A number the provider rejects is dropped
    // by TurnCall anyway; sending it would just make the saved scenario
    // disagree with what runs.
    if (warm && temperature.trim() !== "") block.temperature = Number(temperature);
    return block;
  }

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
          // Sent every save, null included: null is what takes a scenario back
          // to the platform default, and omitting it would leave a judge
          // permanent once one was picked (turncall#122).
          judge: judgeBlock(),
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
        <p className="hint" style={{ margin: "4px 0 0" }}>
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
        <p className="hint" style={{ margin: "4px 0 0" }}>
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
        <p className="hint" style={{ margin: "4px 0 0" }}>
          What each tool returns on a rerun. A mock that has drifted from what
          the real tool now returns leaves the scenario passing while proving
          nothing.
        </p>
      </div>

      <div className="field">
        <label htmlFor="ed-judge">Judge</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            id="ed-judge"
            className="input"
            style={{ maxWidth: 220 }}
            value={provider}
            onChange={(e) => changeProvider(e.target.value)}
          >
            <option value={INHERIT}>Platform default</option>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {provider !== INHERIT && known.length > 0 && !typing && (
            /* A real select where the provider has a shortlist, because a
               datalist could not reopen. `<input list>` filters its options by
               the field's own value, so once it held `jev-latest` nothing else
               matched it and `jev-preview` was unreachable without emptying the
               field first — a picker that works once. Typing is still reachable,
               through OTHER below. */
            <select
              className="input"
              style={{ maxWidth: 260 }}
              value={judgeModel}
              aria-label="Judge model"
              onChange={(e) =>
                e.target.value === OTHER ? setTyping(true) : setJudgeModel(e.target.value)
              }
            >
              <option value="">
                {PROVIDERS.find((p) => p.id === provider)?.defaultModel}
              </option>
              {known.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value={OTHER}>Other…</option>
            </select>
          )}
          {provider !== INHERIT && (known.length === 0 || typing) && (
            /* A plain text field: a provider ships a new model long before this
               list hears about it, and an Ollama model is whatever that box
               serves. */
            <input
              className="input"
              style={{ maxWidth: 260 }}
              value={judgeModel}
              autoComplete="off"
              spellCheck={false}
              autoFocus={typing}
              aria-label="Judge model"
              placeholder={PROVIDERS.find((p) => p.id === provider)?.defaultModel}
              onChange={(e) => setJudgeModel(e.target.value)}
            />
          )}
          {warm && (
            <input
              className="input"
              style={{ maxWidth: 140 }}
              value={temperature}
              inputMode="decimal"
              aria-label="Judge temperature"
              placeholder="temperature"
              onChange={(e) => setTemperature(e.target.value)}
            />
          )}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          {provider === INHERIT ? (
            <>
              Whatever this TurnCall is configured to judge with — a local Ollama
              unless someone set <code>EVAL_JUDGE_PROVIDER</code>. Pick a model here
              to decide it for this scenario alone.
            </>
          ) : provider === "jev" ? (
            // Without this branch Jev fell through to the reasoning-model text
            // and told the author that OpenAI rejects a temperature, which is
            // true of nothing they selected. The second sentence is the part
            // that surprises people: a classifier gives probabilities and no
            // prose, and the reason comes from whatever the platform judge is.
            <>
              A classifier, not an LLM: a verdict in a few hundred milliseconds
              with a calibrated probability, and no temperature to set. Written
              reasons come from the platform judge —{" "}
              <code>EVAL_JUDGE_PROVIDER</code> — and a platform with none set, or
              set to Jev, reports probabilities without prose.
            </>
          ) : provider === "anthropic" ? (
            <>
              Claude rejects a temperature outright, so none is sent. Costs model
              time on every <code>eval:</code> expectation and every simulation
              turn scored.
            </>
          ) : !warm ? (
            <>
              OpenAI&apos;s reasoning models reject a temperature, so none is sent.
              Costs model time on every <code>eval:</code> expectation and every
              simulation turn scored.
            </>
          ) : (
            <>
              Decides <code>eval:</code> expectations and simulation verdicts —
              <code>text_contains</code> is checked without a judge. A hosted one
              costs model time on every such expectation and every simulation turn
              scored. Leave the temperature empty for 0: a verdict that varies run
              to run is not a verdict.
            </>
          )}
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

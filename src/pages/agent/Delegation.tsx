// gpt-live-1 (the openai_live S2S provider) calls no tools of its own: it hands
// anything needing a tool to a *delegate* and voices the result. This edits that
// one block, s2s.delegation, in either of TurnCall's two modes:
// - client (turncall#244): the agent's own LLM. TurnCall's default for an agent
//   with tools, so a client block is only sent when it carries a setting.
// - responses (turncall#243): an OpenAI-hosted Responses model.
import type { ReactNode } from "react";

export type DelegationValue = {
  mode: "client" | "responses";
  model?: string;
  reasoning_effort?: string;
  service_tier?: string;
  instructions?: string;
  timeout_seconds?: number;
};

// What the live eval measured working end to end.
const DEFAULT_MODEL = "gpt-5-mini";
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const TIERS = ["auto", "default", "flex", "priority"];

type Props = {
  value: DelegationValue | undefined;
  /** OpenAI models the workspace's key can use; empty falls back to typing one. */
  models: string[];
  /** Whether the agent lists any tool — without one no delegate is used. */
  hasTools: boolean;
  /** Ticked call-control built-ins: TurnCall refuses them in client mode (#245). */
  callControl?: string[];
  /** The agent's LLM provider/model fields — the client-mode delegate. */
  llmPicker?: ReactNode;
  editable: boolean;
  onChange: (next: DelegationValue | undefined) => void;
};

export function Delegation({
  value,
  models,
  hasTools,
  callControl = [],
  llmPicker,
  editable,
  onChange,
}: Props) {
  const mode = value?.mode ?? "client";

  // A blank optional field is left out, never sent as "": TurnCall refuses an
  // empty reasoning effort, tier or instructions. A client block left with no
  // setting is dropped — it is what TurnCall does without one.
  const set = (key: keyof DelegationValue, raw: string | number | undefined) => {
    const next: Record<string, unknown> = { mode, ...value };
    if (raw === "" || raw === undefined) delete next[key];
    else next[key] = raw;
    const bare = next.mode === "client" && Object.keys(next).length === 1;
    onChange(bare ? undefined : (next as DelegationValue));
  };

  return (
    <div className="field">
      <label htmlFor="cfg-dlg-mode">Delegate</label>
      <select
        id="cfg-dlg-mode"
        className="input"
        value={mode}
        disabled={!editable}
        onChange={(e) =>
          onChange(
            e.target.value === "responses" ? { mode: "responses", model: DEFAULT_MODEL } : undefined,
          )
        }
      >
        <option value="client">The agent's own LLM (default)</option>
        <option value="responses">An OpenAI Responses model</option>
      </select>
      <p className="hint" style={{ margin: "2px 0 0" }}>
        GPT-Live-1 only listens and speaks. It hands anything that needs a tool to the
        delegate, then tells the caller what came back.
        {!hasTools && " This agent has no tools, so no delegate is used."}
      </p>
      {mode === "client" && callControl.length > 0 && (
        <p className="hint" role="alert" style={{ margin: "4px 0 0", color: "var(--danger, #c0392b)" }}>
          {callControl.join(", ")} need an OpenAI Responses delegate for now: the agent's own
          LLM can't end or transfer the call yet, so saving will be refused.
        </p>
      )}

      {mode === "client" && llmPicker}

      {mode === "responses" && value && (
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="cfg-dlg-model">Delegate model</label>
            {models.length > 0 ? (
              <select
                id="cfg-dlg-model"
                className="input"
                value={value.model}
                disabled={!editable}
                onChange={(e) => set("model", e.target.value)}
              >
                {/* The current model stays selectable even when the list lacks it. */}
                {[...new Set([value.model, ...models])].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                id="cfg-dlg-model"
                className="input"
                value={value.model}
                disabled={!editable}
                placeholder={DEFAULT_MODEL}
                onChange={(e) => set("model", e.target.value)}
              />
            )}
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="cfg-dlg-effort">Reasoning effort</label>
            <select
              id="cfg-dlg-effort"
              className="input"
              value={value.reasoning_effort || ""}
              disabled={!editable}
              onChange={(e) => set("reasoning_effort", e.target.value)}
            >
              <option value="">model default</option>
              {EFFORTS.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="cfg-dlg-tier">Service tier</label>
            <select
              id="cfg-dlg-tier"
              className="input"
              value={value.service_tier || ""}
              disabled={!editable}
              onChange={(e) => set("service_tier", e.target.value)}
            >
              <option value="">default</option>
              {TIERS.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <div className="field" style={{ flex: 3 }}>
          <label htmlFor="cfg-dlg-instr">Delegate instructions</label>
          <textarea
            id="cfg-dlg-instr"
            className="input"
            rows={3}
            value={value?.instructions || ""}
            disabled={!editable}
            placeholder="Optional. Replaces the system prompt for the delegate only."
            onChange={(e) => set("instructions", e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="cfg-dlg-timeout">Timeout (s)</label>
          <input
            id="cfg-dlg-timeout"
            className="input"
            type="number"
            min={1}
            max={300}
            value={value?.timeout_seconds ?? ""}
            placeholder="30"
            disabled={!editable}
            onChange={(e) =>
              set("timeout_seconds", e.target.value === "" ? undefined : Number(e.target.value))
            }
          />
        </div>
      </div>
    </div>
  );
}

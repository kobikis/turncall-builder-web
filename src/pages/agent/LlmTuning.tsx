// The agent LLM's sampling (#63): temperature, max tokens, reasoning effort.
// Blank is TurnCall's default (0.7 and 1024; no reasoning effort).
import { NumberField, withField } from "./SettingFields";

type Llm = Record<string, unknown>;

// TurnCall sends reasoning_effort to OpenAI-family endpoints only.
const REASONING_PROVIDERS = ["openai", "openrouter", "custom_openai"];
const EFFORTS = ["minimal", "low", "medium", "high"];

export function LlmTuning({ value, onChange }: { value: Llm | undefined; onChange: (next: Llm) => void }) {
  const provider = String(value?.provider || "openai");
  const set = (key: string, v: unknown) => onChange(withField(value, key, v));
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <NumberField
        id="cfg-llm-temp"
        label="Temperature"
        step="0.1"
        value={value?.temperature}
        placeholder="0.7"
        hint={provider === "anthropic" ? "Not sent to Claude models — they reject it." : undefined}
        onChange={(v) => set("temperature", v)}
      />
      <NumberField
        id="cfg-llm-max"
        label="Max tokens"
        value={value?.max_tokens}
        placeholder="1024"
        onChange={(v) => set("max_tokens", v)}
      />
      {REASONING_PROVIDERS.includes(provider) && (
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="cfg-llm-effort">Reasoning effort</label>
          <select
            id="cfg-llm-effort"
            className="input"
            value={String(value?.reasoning_effort || "")}
            onChange={(e) => set("reasoning_effort", e.target.value)}
          >
            <option value="">— model default —</option>
            {EFFORTS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <p className="hint" style={{ margin: "4px 0 0" }}>Reasoning models only (o-series, gpt-5).</p>
        </div>
      )}
    </div>
  );
}

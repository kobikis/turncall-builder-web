import { useState } from "react";
import { api } from "../../api";

// How the agent reads its documents — TurnCall's knowledge-base link modes.
export type RetrievalMode = "prompt" | "auto" | "tool";
export type RetrievalSetting = { mode: RetrievalMode; top_k?: number; tool_description?: string | null };

const MODES: { mode: RetrievalMode; label: string; says: string }[] = [
  {
    mode: "prompt",
    label: "Whole documents",
    says: "Every reply reads all of them. Best for a page or two.",
  },
  {
    mode: "auto",
    label: "Search each turn",
    says: "Before each reply, the best-matching passages are found and added. For menus, catalogues, policies.",
  },
  {
    mode: "tool",
    label: "Agent searches",
    says: "The agent looks things up only when it decides it needs to. For large or rarely needed documents.",
  },
];

// Past this, "whole documents" puts thousands of tokens in front of every
// reply — measured on a 16.7k-character menu, about a second of LLM time a turn.
export const LARGE_FOR_PROMPT_CHARS = 5000;

export default function Retrieval({
  agentId,
  setting,
  totalChars,
  speechToSpeech,
  editable,
  onChange,
}: {
  agentId: string;
  setting: RetrievalSetting;
  totalChars: number;
  speechToSpeech: boolean;
  editable: boolean;
  onChange: (s: RetrievalSetting) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const current = MODES.find((m) => m.mode === setting.mode) ?? MODES[0];

  async function choose(mode: RetrievalMode) {
    if (mode === setting.mode || saving) return;
    setSaving(true);
    setError("");
    try {
      const r = await api(`/agents/${agentId}/knowledge/retrieval`, {
        method: "PUT",
        body: JSON.stringify({ mode }),
      });
      onChange(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change how the agent reads its documents.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 500, fontSize: 13 }}>How the agent reads these</span>
        <div role="group" aria-label="How the agent reads its documents" className="seg">
          {MODES.map((m) => {
            // A realtime model has no point before each reply to add passages
            // at: TurnCall skips `auto` on speech-to-speech with a warning.
            const unavailable = m.mode === "auto" && speechToSpeech;
            return (
              <button
                key={m.mode}
                type="button"
                aria-pressed={setting.mode === m.mode}
                disabled={!editable || saving || unavailable}
                title={unavailable ? "Not available on a speech-to-speech agent" : undefined}
                onClick={() => choose(m.mode)}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        {saving && <span className="muted" style={{ fontSize: 13 }}>Saving…</span>}
      </div>
      <p className="hint" style={{ margin: "6px 0 0" }}>
        {current.says} {totalChars > 0 && `${totalChars.toLocaleString()} characters in all.`}
      </p>
      {setting.mode === "prompt" && totalChars > LARGE_FOR_PROMPT_CHARS && (
        <p className="callout info" style={{ marginTop: 8 }}>
          Every reply reads all {totalChars.toLocaleString()} characters, which slows each one down.
          {speechToSpeech ? " Agent searches" : " Search each turn"} sends only what the question needs.
        </p>
      )}
      {error && <p role="alert" className="error-text">{error}</p>}
    </div>
  );
}

import { useState } from "react";
import { api } from "../../api";
import type { Doc, RetrievalMode, RetrievalSetting } from "../../types";

// How the agent reads one document — TurnCall's knowledge-base link modes.
// Each document has a knowledge base, and so a mode, of its own
// (builder-api ADR-0024).
export const MODES: { mode: RetrievalMode; label: string; says: string }[] = [
  { mode: "prompt", label: "Whole", says: "All of it goes into every reply. Best for a page or two." },
  { mode: "auto", label: "Search each turn", says: "The best-matching passages are added before each reply." },
  { mode: "tool", label: "Agent searches", says: "The agent looks it up only when it decides it needs to." },
];

// Past this, "whole" puts thousands of tokens in front of every reply —
// measured on a 16.7k-character menu, about a second of LLM time a turn.
export const LARGE_FOR_PROMPT_CHARS = 5000;

export default function DocumentRetrieval({
  agentId,
  doc,
  speechToSpeech,
  editable,
  onChange,
}: {
  agentId: string;
  doc: Doc;
  speechToSpeech: boolean;
  editable: boolean;
  onChange: (s: RetrievalSetting) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mode = doc.retrieval?.mode ?? "prompt";
  const current = MODES.find((m) => m.mode === mode) ?? MODES[0];
  const large = mode === "prompt" && doc.char_count > LARGE_FOR_PROMPT_CHARS;

  async function choose(next: RetrievalMode) {
    if (next === mode || saving) return;
    setSaving(true);
    setError("");
    try {
      const r = await api(`/agents/${agentId}/knowledge/documents/${doc.id}/retrieval`, {
        method: "PUT",
        body: JSON.stringify({ mode: next }),
      });
      onChange(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change how this document is read.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minWidth: 150 }}>
      <select
        className="input"
        style={{ padding: "3px 6px" }}
        aria-label={`How the agent reads ${doc.filename}`}
        title={current.says}
        value={mode}
        disabled={!editable || saving}
        onChange={(e) => choose(e.target.value as RetrievalMode)}
      >
        {MODES.map((m) => (
          // A realtime model has no point before each reply to add passages
          // at: TurnCall skips `auto` on speech-to-speech with a warning.
          <option key={m.mode} value={m.mode} disabled={m.mode === "auto" && speechToSpeech}>
            {m.label}
          </option>
        ))}
      </select>
      {large && (
        <div className="hint" style={{ marginTop: 4 }}>
          Every reply reads all {doc.char_count.toLocaleString()} characters, which slows it down —
          {speechToSpeech ? " Agent searches" : " Search each turn"} sends only what's needed.
        </div>
      )}
      {error && (
        <div role="alert" className="error-text">
          {error}
        </div>
      )}
    </div>
  );
}

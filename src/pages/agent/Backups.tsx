// Backup providers for one stage (#63): TurnCall's llm/stt/tts `failover`, an
// ordered list tried in turn when the active provider reports an error that
// leaves it unusable (a refused key, an unknown model). An empty list is the
// key removed. Models are typed rather than picked: a live list per row would
// fetch per provider, and a backup is set once.
type Entry = Record<string, string>;

const FIELD = { llm: "model", stt: "model", tts: "voice" } as const;
const ROLE_LABEL = { llm: "LLM", stt: "STT", tts: "TTS" } as const;

export function Backups({ role, providers, value, editable, onChange }: {
  role: keyof typeof FIELD;
  providers: string[];
  value: Entry[] | undefined;
  editable: boolean;
  onChange: (next: Entry[] | undefined) => void;
}) {
  const rows = Array.isArray(value) ? value : [];
  const field = FIELD[role];
  const emit = (next: Entry[]) => onChange(next.length ? next : undefined);
  const edit = (i: number, key: string, v: string) =>
    emit(rows.map((r, j) => {
      if (j !== i) return r;
      const { [key]: _old, ...rest } = r;
      return v ? { ...rest, [key]: v } : rest;
    }));

  return (
    <div className="field">
      <label>Backup {ROLE_LABEL[role]}{rows.length ? ` (${rows.length})` : ""}</label>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <select
            aria-label={`Backup ${ROLE_LABEL[role]} ${i + 1} provider`}
            className="input"
            value={row.provider || ""}
            disabled={!editable}
            onChange={(e) => edit(i, "provider", e.target.value)}
          >
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input
            aria-label={`Backup ${ROLE_LABEL[role]} ${i + 1} ${field}`}
            className="input"
            value={row[field] || ""}
            placeholder={role === "tts" ? "voice" : "model (blank = provider default)"}
            disabled={!editable}
            onChange={(e) => edit(i, field, e.target.value)}
          />
          <button className="btn" disabled={!editable} onClick={() => emit(rows.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button
        className="btn"
        disabled={!editable}
        onClick={() => emit([...rows, { provider: providers[0] }])}
      >
        Add backup {ROLE_LABEL[role]}
      </button>
      <p className="hint" style={{ margin: "4px 0 0" }}>
        Tried in order when the {ROLE_LABEL[role]} refuses the call (bad key, unknown model) — not on a timeout or rate limit.
      </p>
    </div>
  );
}

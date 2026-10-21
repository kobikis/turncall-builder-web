// Backup providers for one stage (#63): TurnCall's llm/stt/tts `failover`, an
// ordered list tried in turn when the active provider reports an error that
// leaves it unusable (a refused key, an unknown model). An empty list is the
// key removed. Each row picks its model/voice from the same live list the main
// field uses, fetched for that row's provider.
import { useEffect, useState } from "react";
import { api } from "../../api";
import { PickControl, type Opt } from "./PickControl";

type Entry = Record<string, string>;

// What each row picks beside its provider. Deepgram's TTS voice is its model
// and xAI's TTS has none, so their TTS rows pick a voice only.
const FIELDS = { llm: ["model"], stt: ["model"], tts: ["model", "voice"] } as const;
type Role = keyof typeof FIELDS;
const fieldsFor = (role: Role, provider: string | undefined): readonly string[] =>
  role === "tts" && (provider === "deepgram" || provider === "xai") ? ["voice"] : FIELDS[role];
const ROLE_LABEL = { llm: "LLM", stt: "STT", tts: "TTS" } as const;

function useOptions(role: Role, provider: string | undefined, field: string): Opt[] {
  const [opts, setOpts] = useState<Opt[]>([]);
  useEffect(() => {
    if (!provider) return setOpts([]);
    let ok = true;
    const kind = `${field}s`; // "models" | "voices"
    api(`/providers/${role}/${provider}/${kind}`)
      .then((r) => ok && setOpts(r.data[kind] || []))
      .catch(() => ok && setOpts([]));
    return () => {
      ok = false;
    };
  }, [role, provider, field]);
  return opts;
}

function FieldPick({ role, provider, field, ...rest }: {
  role: Role; provider: string | undefined; field: string; value: string;
  placeholder: string; onChange: (v: string) => void; "aria-label": string; disabled: boolean;
}) {
  return <PickControl {...rest} options={useOptions(role, provider, field)} />;
}

export function Backups({ role, providers, value, editable, onChange }: {
  role: Role;
  providers: string[];
  value: Entry[] | undefined;
  editable: boolean;
  onChange: (next: Entry[] | undefined) => void;
}) {
  const rows = Array.isArray(value) ? value : [];
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
            // Another provider's model or voice would be refused (an OpenAI
            // voice on Deepgram is an HTTP 400), so the pick starts over.
            onChange={(e) => emit(rows.map((r, j) => {
              if (j !== i) return r;
              // Keep what is not a pick (keyterms, extra…); drop every pick.
              const rest = Object.fromEntries(
                Object.entries(r).filter(([k]) => !(FIELDS[role] as readonly string[]).includes(k)),
              );
              return { ...rest, provider: e.target.value };
            }))}
          >
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {fieldsFor(role, row.provider).map((field) => (
            <FieldPick
              key={field}
              role={role}
              provider={row.provider}
              field={field}
              aria-label={`Backup ${ROLE_LABEL[role]} ${i + 1} ${field}`}
              value={row[field] || ""}
              placeholder={field === "voice" ? "voice" : "model (blank = provider default)"}
              disabled={!editable}
              onChange={(v) => edit(i, field, v)}
            />
          ))}
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

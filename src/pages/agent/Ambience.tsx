import { useEffect, useRef, useState } from "react";
import { api, getActiveWorkspaceId } from "../../api";
import { Section } from "./Section";

// A room the agent sounds like it is in (turncall ADR-0021): a project's uploaded
// sound, mixed quietly under everything the agent says, for the whole call.

export type AmbienceValue = { sound: string; volume?: number };

export type AmbienceSound = {
  id: string;
  name: string;
  duration_ms: number;
  rates: number[];
  warnings?: { code: string; message: string }[];
};

// TurnCall's default: an 8 kHz phone line carries background energy more
// intrusively than a browser call does.
export const DEFAULT_VOLUME = 0.3;
// What a phone caller hears. The preview defaults to it because forced mono at
// 8 kHz is the change an uploader most needs to hear before a customer does.
const PREVIEW_RATES = [
  { rate: 8000, label: "Phone (8 kHz)" },
  { rate: 16000, label: "Browser (16 kHz)" },
];
const ACCEPT = "audio/*,.wav,.mp3,.flac,.ogg,.aiff,.aif";

type Props = {
  agentId: string;
  value: AmbienceValue | undefined;
  editable: boolean;
  onChange: (next: AmbienceValue | undefined) => void;
};

const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;

/**
 * Ambience on an agent. Uploading and deleting sounds act immediately — they are
 * the project's files. Which one plays, and how loud, is ordinary config that
 * the Config tab's Save applies, like every other field on it.
 */
export function Ambience({ agentId, value, editable, onChange }: Props) {
  const [sounds, setSounds] = useState<AmbienceSound[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // TurnCall's advisory notes on the last upload (a sound a phone won't carry).
  const [warnings, setWarnings] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [previewRate, setPreviewRate] = useState(PREVIEW_RATES[0].rate);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api(`/agents/${agentId}/ambience/sounds`)
      .then((r) => setSounds(r.data.sounds))
      .catch((e) => setError(e.message));
  }, [agentId]);

  // Blob URLs hold the audio in memory until revoked.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview.url)), [preview]);

  const chosen = sounds?.find((s) => s.id === value?.sound);
  const volume = value?.volume ?? DEFAULT_VOLUME;

  async function upload(file: File) {
    setError("");
    setWarnings([]);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api(`/agents/${agentId}/ambience/sounds`, { method: "POST", body: form });
      const sound: AmbienceSound = r.data;
      setSounds((prev) => [...(prev || []), sound]);
      setWarnings((sound.warnings || []).map((w) => w.message));
      // Uploading one is almost always to use it.
      onChange({ sound: sound.id, volume });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(sound: AmbienceSound) {
    if (!confirm(`Delete "${sound.name}"? This removes it from the project.`)) return;
    setError("");
    setBusy(true);
    try {
      // TurnCall refuses (naming the agent) while a saved config still uses it.
      await api(`/agents/${agentId}/ambience/sounds/${sound.id}`, { method: "DELETE" });
      setSounds((prev) => (prev || []).filter((s) => s.id !== sound.id));
      if (value?.sound === sound.id) onChange(undefined);
      if (preview?.id === sound.id) setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function play(sound: AmbienceSound, rate = previewRate) {
    setError("");
    try {
      // A bare <audio src> can't attach X-Workspace-Id, so fetch with the
      // header and play a blob URL — the same reason the call recording does.
      const ws = getActiveWorkspaceId();
      const r = await fetch(`/api/agents/${agentId}/ambience/sounds/${sound.id}/audio?rate=${rate}`, {
        credentials: "same-origin",
        headers: ws ? { "X-Workspace-Id": ws } : {},
      });
      if (!r.ok) throw new Error(`audio ${r.status}`);
      setPreview({ id: sound.id, url: URL.createObjectURL(await r.blob()) });
    } catch {
      setError(`Couldn't load "${sound.name}".`);
    }
  }

  return (
    <Section id="ambience" title="Ambience" hint={chosen ? chosen.name : value ? "sound missing" : "off"}>
      <p className="hint" style={{ marginTop: 0 }}>
        A room the agent sounds like it is in — a quiet recording under everything it says, for the
        whole call, on phone and browser calls. Upload a recording of a real place (voices, dishes):
        a phone line only carries 300–3400 Hz, so a low rumble is silent on a call. The sound and
        volume you pick apply when you Save.
      </p>

      <div className="radio-row" role="radiogroup" aria-label="Ambience sound" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
        <label>
          <input type="radio" name="ambience" checked={!value} disabled={!editable} onChange={() => onChange(undefined)} />{" "}
          None
        </label>
        {(sounds || []).map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label>
              <input
                type="radio"
                name="ambience"
                checked={value?.sound === s.id}
                disabled={!editable}
                onChange={() => onChange({ sound: s.id, volume })}
              />{" "}
              {s.name} <span className="muted">· {seconds(s.duration_ms)}</span>
            </label>
            <button className="btn" style={{ padding: "2px 8px" }} onClick={() => play(s)} aria-label={`Preview ${s.name}`}>
              ▶
            </button>
            {editable && (
              <button className="btn btn-danger" style={{ padding: "2px 8px" }} disabled={busy} onClick={() => remove(s)} aria-label={`Delete ${s.name}`}>
                delete
              </button>
            )}
          </div>
        ))}
        {sounds === null && !error && <span className="muted">Loading…</span>}
      </div>

      {value && sounds && !chosen && (
        <p className="callout warn">
          The saved sound is no longer in this project, so calls run without ambience. Choose another or None.
        </p>
      )}

      {preview && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <audio key={preview.url} src={preview.url} controls autoPlay aria-label="Ambience preview" />
          <select
            className="input"
            style={{ width: "auto" }}
            aria-label="Preview as"
            value={previewRate}
            onChange={(e) => {
              const rate = Number(e.target.value);
              setPreviewRate(rate);
              const s = sounds?.find((x) => x.id === preview.id);
              if (s) play(s, rate);
            }}
          >
            {PREVIEW_RATES.map((p) => (
              <option key={p.rate} value={p.rate}>{p.label}</option>
            ))}
          </select>
        </div>
      )}

      {value && (
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="cfg-ambience-volume">Volume · {volume.toFixed(2)}</label>
          <input
            id="cfg-ambience-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            disabled={!editable}
            onChange={(e) => onChange({ ...value, volume: Number(e.target.value) })}
          />
        </div>
      )}

      {editable && (
        <div style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => uploadRef.current?.click()} disabled={busy}>
            {busy ? "Working…" : "+ Upload sound"}
          </button>
          <span className="hint" style={{ marginLeft: 8 }}>
            WAV, MP3, FLAC, OGG or AIFF · up to 60s and 10 MB · it loops
          </span>
          <input
            ref={uploadRef}
            type="file"
            hidden
            accept={ACCEPT}
            aria-label="Upload ambience sound"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload(f);
            }}
          />
        </div>
      )}

      {warnings.map((w) => (
        <p key={w} className="callout warn" role="status">{w}</p>
      ))}
      {error && <p role="alert" className="error-text">{error}</p>}
    </Section>
  );
}

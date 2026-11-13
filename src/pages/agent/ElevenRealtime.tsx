// Eleven Realtime's session settings (builder-api#139, turncall#465): the
// language it hears and answers in and its turn eagerness ride in s2s.extra,
// temperature on the s2s block. Blank is ElevenLabs' default.
import { NumberField, withField } from "./SettingFields";

type Block = Record<string, unknown>;
const EAGERNESS = ["low", "medium", "high"];

export function ElevenRealtime({ value, onChange }: { value: Block | undefined; onChange: (next: Block) => void }) {
  const extra = (value?.extra as Block | undefined) || {};
  const setExtra = (key: string, v: unknown) => {
    const next = withField(extra, key, v);
    onChange(withField(value, "extra", Object.keys(next).length ? next : undefined));
  };
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div className="field" style={{ flex: 1 }}>
        <label htmlFor="cfg-s2s-lang">Language</label>
        <input
          id="cfg-s2s-lang"
          className="input"
          value={String(extra.language || "")}
          placeholder="en"
          onChange={(e) => setExtra("language", e.target.value.trim())}
        />
      </div>
      <div className="field" style={{ flex: 1 }}>
        <label htmlFor="cfg-s2s-eager">Turn eagerness</label>
        <select
          id="cfg-s2s-eager"
          className="input"
          value={String(extra.eagerness || "")}
          onChange={(e) => setExtra("eagerness", e.target.value)}
        >
          <option value="">— default —</option>
          {EAGERNESS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      <NumberField
        id="cfg-s2s-temp"
        label="Temperature"
        step="0.1"
        value={value?.temperature}
        placeholder="default"
        onChange={(v) => onChange(withField(value, "temperature", v))}
      />
    </div>
  );
}

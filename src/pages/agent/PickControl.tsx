// An option is either a bare id (models) or {value,label} (voices where the
// config value is an id but we show a friendly name, e.g. ElevenLabs/Cartesia).
export type Opt = string | { value: string; label: string };

// Live options -> real <select> (a datalist gave no visible dropdown to choose from).
// Empty list (ollama/custom, or a provider with no key) -> free text.
export function PickControl({ value, options, placeholder, onChange, ...attrs }: {
  value: string; options: Opt[]; placeholder: string; onChange: (v: string) => void;
  id?: string; "aria-label"?: string; disabled?: boolean;
}) {
  if (options.length === 0) {
    return <input {...attrs} className="input" value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} />;
  }
  const norm = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  // Keep the current value selectable even if it's not in the fetched list.
  const opts = value && !norm.some((o) => o.value === value)
    ? [{ value, label: value }, ...norm]
    : norm;
  return (
    <select {...attrs} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— select —</option>
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

import { useState } from "react";

// An option is either a bare id (models) or {value,label} (voices where the
// config value is an id but we show a friendly name, e.g. ElevenLabs/Cartesia).
export type Opt = string | { value: string; label: string };

// Chosen in the <select> to type instead; never a value a list holds.
const TYPE_INSTEAD = "\u0000type";

// Live options -> real <select> (a datalist gave no visible dropdown to choose from).
// Empty list (ollama/custom, or a provider with no key) -> free text.
// `other` names an option that swaps the list for free text, for a list that
// may not hold every valid value (one page of an account's Avatars); leaving
// the text field goes back to the list, which keeps the typed value as the choice.
export function PickControl({ value, options, placeholder, onChange, other, ...attrs }: {
  value: string; options: Opt[]; placeholder: string; onChange: (v: string) => void;
  other?: string; id?: string; "aria-label"?: string; disabled?: boolean;
}) {
  const [typing, setTyping] = useState(false);
  if (options.length === 0 || typing) {
    return <input {...attrs} className="input" value={value} placeholder={placeholder} autoFocus={typing}
      onChange={(e) => onChange(e.target.value)} onBlur={() => setTyping(false)} />;
  }
  const norm = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  // Keep the current value selectable even if it's not in the fetched list.
  const opts = value && !norm.some((o) => o.value === value)
    ? [{ value, label: value }, ...norm]
    : norm;
  return (
    <select {...attrs} className="input" value={value}
      onChange={(e) => (e.target.value === TYPE_INSTEAD ? setTyping(true) : onChange(e.target.value))}>
      <option value="">— select —</option>
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      {other && <option value={TYPE_INSTEAD}>{other}</option>}
    </select>
  );
}

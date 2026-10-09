// Shared plumbing for the agent settings TurnCall defaults when they are absent
// (builder-api#71). Every one of them has the same rule: a cleared field is a
// removed key, never "" or null — TurnCall reads absence as its default and
// refuses null — while false and 0 are real values.

type Block = Record<string, unknown>;

/** A copy of `obj` with `key` set, or removed when `value` means "unset". */
export function withField<T extends Block>(obj: T | undefined, key: string, value: unknown): T {
  const next: Block = { ...obj };
  const unset = value === undefined || value === "" || (typeof value === "number" && Number.isNaN(value));
  if (unset) delete next[key];
  else next[key] = value;
  return next as T;
}

/** "" stays "" (cleared); anything else is a number. */
export const numberOrBlank = (raw: string): number | "" => (raw.trim() === "" ? "" : Number(raw));

export function NumberField({ id, label, value, placeholder, hint, step, disabled, onChange }: {
  id: string;
  label: string;
  value: unknown;
  placeholder: string;
  hint?: string;
  step?: string;
  disabled?: boolean;
  onChange: (v: number | "") => void;
}) {
  return (
    <div className="field" style={{ flex: 1 }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type="number"
        step={step}
        value={typeof value === "number" ? value : ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(numberOrBlank(e.target.value))}
      />
      {hint && <p className="hint" style={{ margin: "4px 0 0" }}>{hint}</p>}
    </div>
  );
}

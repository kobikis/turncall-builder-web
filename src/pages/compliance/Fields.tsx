// The redaction and retention controls the Workspace page and an Agent's
// override share, and the copy that says what each one does and does not do.
import {
  KINDS,
  MAX_DAYS,
  parseDays,
  describeDays,
  type Projection,
  type Retention,
  type RetentionKind,
} from "../../compliance";

export type RedactionForm = { enabled: boolean; picked: string[] };
// `days` is the field's text; `forever` keeps that kind for good.
export type RetentionForm = Record<RetentionKind, { days: string; forever: boolean }>;

/** What redaction does, and — said first — what it never does. */
export function RedactionCopy() {
  return (
    <div className="callout info">
      <strong>Redaction never changes what the agent hears.</strong> During the call the agent and its
      model hear everything the caller says, so it can still book the appointment with the number it
      was given. Redaction changes what is stored and sent after the caller says it: the transcript,
      the call's events and webhooks, post-call analysis, takeaways, tool invocations, logs and traces
      read <code>&lt;PHONE_NUMBER&gt;</code> where the number was.
      <p>
        Text only: the recording is not bleeped. Every voice call is recorded, and that cannot be turned
        off, so if recordings may hold personal details, keep them for a short time under Retention. The
        call record keeps its numbers, so routing, the do-not-call list and campaigns work as before.
      </p>
      <p>
        Detection runs inside your deployment, in English only, and misses what speech-to-text spelled
        out in words. A change applies to what is stored next; nothing already stored is rewritten.
      </p>
    </div>
  );
}

export function RetentionCopy() {
  return (
    <p className="hint" style={{ marginTop: 0 }}>
      Whole days from the call's end; what has expired is deleted within the hour. Unset keeps everything.
      Shortening a period deletes what is already past it, and lengthening one brings nothing back. The
      call record itself (its id, numbers, times and status) is never deleted. Text conversations (SMS,
      WhatsApp, chat) are not covered yet.
    </p>
  );
}

export function RedactionEditor({ value, onChange, supported, defaults, disabled, idPrefix }: {
  value: RedactionForm;
  onChange: (next: RedactionForm) => void;
  supported: string[];
  defaults: string[];
  disabled?: boolean;
  idPrefix: string;
}) {
  const toggle = (entity: string, on: boolean) =>
    onChange({
      ...value,
      picked: on ? [...value.picked, entity] : value.picked.filter((e) => e !== entity),
    });
  const others = supported.filter((e) => !defaults.includes(e));
  const box = (entity: string) => (
    <label key={entity} className="mono">
      <input
        type="checkbox"
        checked={value.picked.includes(entity)}
        disabled={disabled}
        onChange={(e) => toggle(entity, e.target.checked)}
      />
      {entity}
    </label>
  );
  return (
    <>
      <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        Redact personal details from what is stored and sent
      </label>
      {value.enabled && (
        <fieldset id={`${idPrefix}-entities`} style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
          <legend className="hint">Entity types to replace</legend>
          <div className="radio-row" role="group" aria-label="Default entity types">{defaults.map(box)}</div>
          <div className="hint">
            Also available. <code>PERSON</code> is off by default because the detector gets names wrong,
            taking a company for a person and missing the name.
          </div>
          <div className="radio-row" role="group" aria-label="Other entity types">{others.map(box)}</div>
          {!disabled && (
            <button type="button" className="link-btn" onClick={() => onChange({ ...value, picked: [...defaults] })}>
              Use the default types
            </button>
          )}
        </fieldset>
      )}
    </>
  );
}

/**
 * One row per kind. On the Workspace an empty field is not allowed unless the
 * kind is kept for good; on an override (`inherited` given) an empty field
 * takes the Workspace's value, and "keep for good" is 36500 days.
 */
export function RetentionEditor({ value, onChange, inherited, disabled, idPrefix }: {
  value: RetentionForm;
  onChange: (next: RetentionForm) => void;
  inherited?: Retention;
  disabled?: boolean;
  idPrefix: string;
}) {
  const set = (key: RetentionKind, patch: Partial<RetentionForm[RetentionKind]>) =>
    onChange({ ...value, [key]: { ...value[key], ...patch } });
  return (
    <>
      {KINDS.map((k) => {
        const id = `${idPrefix}-${k.key}`;
        const row = value[k.key];
        return (
          <div className="field" key={k.key}>
            <label htmlFor={id}>{k.label} (days)</label>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <input
                id={id}
                className="input"
                type="number"
                min={1}
                max={MAX_DAYS}
                style={{ maxWidth: 200 }}
                value={row.forever ? "" : row.days}
                placeholder={inherited ? `Workspace: ${describeDays(inherited[k.key])}` : row.forever ? "kept for good" : "days"}
                disabled={disabled || row.forever}
                onChange={(e) => set(k.key, { days: e.target.value })}
              />
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontWeight: 400, margin: 0 }}>
                <input
                  type="checkbox"
                  aria-label={`Keep ${k.label.toLowerCase()} for good`}
                  checked={row.forever}
                  disabled={disabled}
                  onChange={(e) => set(k.key, { forever: e.target.checked })}
                />
                Keep for good
              </label>
            </div>
            <p className="hint" style={{ margin: "4px 0 0" }}>
              {k.hint}
              {inherited && " Blank takes the Workspace's."}
            </p>
          </div>
        );
      })}
    </>
  );
}

/** The wire value of a retention form, or the first field's error. On the
 *  Workspace (`override` false) a blank field that is not kept for good is an
 *  error; on an override it is null, the Workspace's. */
export function retentionToSend(
  form: RetentionForm,
  override: boolean,
): { retention: Retention; error?: string } {
  const retention = {} as Retention;
  for (const k of KINDS) {
    const row = form[k.key];
    if (row.forever) {
      retention[k.key] = override ? MAX_DAYS : null;
      continue;
    }
    const parsed = parseDays(row.days, k.label);
    if (parsed.error) return { retention, error: parsed.error };
    if (parsed.days === null && !override)
      return { retention, error: `${k.label}: enter a number of days, or keep them for good.` };
    retention[k.key] = parsed.days;
  }
  return { retention };
}

export function retentionForm(r: Retention | null, override: boolean): RetentionForm {
  const form = {} as RetentionForm;
  for (const k of KINDS) {
    const days = r?.[k.key] ?? null;
    form[k.key] = override
      ? { days: days === null || days >= MAX_DAYS ? "" : String(days), forever: days !== null && days >= MAX_DAYS }
      : { days: days === null ? "" : String(days), forever: days === null };
  }
  return form;
}

const BADGE: Record<string, string> = { applied: "running", failed: "failed", pending: "degraded" };

export function ProjectionBadge({ projection }: { projection: Projection }) {
  return <span className={`badge ${BADGE[projection.state] ?? ""}`}>{projection.state}</span>;
}

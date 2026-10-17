// Compliance settings (builder-api #103, ADR-0028): a Workspace's redaction and
// call retention, and an Agent's override of them. The wire shapes, and the
// form <-> wire translation both pages share.

export type Redaction = { enabled: boolean; entities: string[] | null };
export type RetentionKind = "recordings_days" | "transcripts_days" | "events_days";
export type Retention = Record<RetentionKind, number | null>;
export type Setting = { redaction: Redaction; retention: Retention };

// applied: the project holds it; failed: the write was refused (`error` says
// why); pending: the setting changed and no write has reached it yet.
export type ProjectionState = "applied" | "failed" | "pending";
export type Projection = { state: ProjectionState; error: string | null };

export type WorkspaceView = Setting & { set: boolean; updated_at: string | null };

export type WorkspaceReport = WorkspaceView & {
  agents: (Projection & {
    agent_id: string;
    name: string;
    overridden: boolean;
    effective: Setting;
  })[];
  // The Workspace's webhook project (custom call-init numbers), when it has one.
  webhook_numbers: Projection | null;
  complete: boolean;
  entity_types: { supported: string[]; default: string[] };
};

export type AgentReport = {
  workspace: WorkspaceView;
  override: { redaction: Redaction | null; retention: Retention | null };
  effective: Setting;
  projection: Projection;
};

// The engine's own lists (TurnCall services/redaction.py, copied by builder-api).
// The Workspace page reads them from GET /compliance; an Agent's report does not
// carry them, so the override form uses these.
export const DEFAULT_ENTITIES = ["PHONE_NUMBER", "EMAIL_ADDRESS", "CREDIT_CARD", "US_SSN", "IBAN_CODE"];
export const SUPPORTED_ENTITIES = [
  "AGE", "CREDIT_CARD", "CRYPTO", "DATE_TIME", "EMAIL_ADDRESS", "IBAN_CODE",
  "IP_ADDRESS", "LOCATION", "MAC_ADDRESS", "MEDICAL_LICENSE", "NRP",
  "ORGANIZATION", "PERSON", "PHONE_NUMBER", "UK_NHS", "URL", "US_BANK_NUMBER",
  "US_DRIVER_LICENSE", "US_ITIN", "US_PASSPORT", "US_SSN",
];

export const MAX_DAYS = 36500;

export const KINDS: { key: RetentionKind; label: string; hint: string }[] = [
  { key: "recordings_days", label: "Recordings", hint: "The call's audio." },
  {
    key: "transcripts_days",
    label: "Transcripts",
    hint: "What was said and what was made from it: the transcript, tool calls and their results, post-call analysis and takeaways.",
  },
  { key: "events_days", label: "Events", hint: "Every other event on the call's log." },
];

/** The entity types a redaction block names: null is the default set. */
export const entitiesOf = (r: Redaction, defaults: string[] = DEFAULT_ENTITIES): string[] =>
  r.entities ?? defaults;

/** What to send for a picked set: the default set exactly is null, so it keeps
 *  following the engine's default. */
export function entitiesToSend(picked: string[], defaults: string[] = DEFAULT_ENTITIES): string[] | null {
  const a = [...new Set(picked)].sort();
  const b = [...defaults].sort();
  if (a.length === b.length && a.every((e, i) => e === b[i])) return null;
  return a;
}

export function describeRedaction(r: Redaction, defaults: string[] = DEFAULT_ENTITIES): string {
  if (!r.enabled) return "Off";
  return r.entities === null ? `On, the default types (${defaults.join(", ")})` : `On (${r.entities.join(", ")})`;
}

export const describeDays = (days: number | null): string =>
  days === null || days >= MAX_DAYS ? "kept for good" : `${days} day${days === 1 ? "" : "s"}`;

/** "" is empty; otherwise a whole number of days in range, or an error message. */
export function parseDays(raw: string, label: string): { days: number | null; error?: string } {
  const text = raw.trim();
  if (text === "") return { days: null };
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS)
    return { days: null, error: `${label}: a whole number of days from 1 to ${MAX_DAYS}.` };
  return { days: n };
}

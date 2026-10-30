// Pure helpers behind the Audit log page: how a JSON Pointer, a resource type
// and a day range read. Kept out of the component so they're testable alone.

/** What the API shows in place of a secret's value, on both sides of a change.
 *  The change's own `secret: true` says it was masked; entries written before
 *  that flag existed (and TurnCall's own) have only this text. */
export const MASK = "***";

/** A JSON Pointer (RFC 6901) as the field path it names: `/config/llm~1x/0`
 *  reads `config › llm/x › 0`. The empty pointer is the value as a whole. */
export const pointerLabel = (pointer: string): string => {
  if (!pointer) return "(value)";
  return pointer
    .split("/")
    .slice(1)
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(" › ");
};

// The API's closed vocabulary (builder-api app/audit.py RESOURCE_TYPES).
const RESOURCE_LABELS: Record<string, string> = {
  agent: "Agent",
  phone_number: "Phone number",
  integration: "Integration",
  connected_app: "Connected app",
  pipedream_project: "Pipedream project",
  twilio_account: "Twilio account",
  mcp_server: "MCP server",
  member: "Member",
  invite: "Invite",
  skill: "Builder skill",
  linked_repo: "Linked repo",
  compliance: "Compliance",
  capability: "Skill",
  capability_library: "Skill library",
};

/** A resource type as a reader says it; an unknown one (a newer API, or one
 *  of TurnCall's) reads with its underscores turned to spaces. */
export const resourceLabel = (type: string): string =>
  RESOURCE_LABELS[type] ?? type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** A `YYYY-MM-DD` day as its local midnight, or null when it is not one: a
 *  malformed value (a hand-edited link) or a day that does not exist. Built
 *  with setFullYear, since `new Date(y, …)` reads years 0–99 as 1900–1999. */
export const parseDay = (day: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(0);
  date.setFullYear(y, mo, d);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === y && date.getMonth() === mo && date.getDate() === d ? date : null;
};

/** The day, or "" when it is not one, so a malformed `from`/`to` in the URL
 *  reads as no filter rather than as an error. */
export const validDay = (day: string | null | undefined): string => (day && parseDay(day) ? day : "");

/** Whether a date field's value is worth sending: cleared, or a whole day
 *  with a four-digit year. A date input reports each year digit as it is
 *  typed (0002, 0020, 0202, 2026); those are not what anyone meant. */
export const isCompleteDay = (day: string): boolean => {
  if (day === "") return true;
  const date = parseDay(day);
  return date !== null && date.getFullYear() >= 1000;
};

/** An inclusive local `YYYY-MM-DD` range as the API's `since` (inclusive) and
 *  `until` (exclusive) instants: midnight starting `from`, and midnight ending
 *  `to`. Local, as every day filter in the console is (see dates.ts). A bound
 *  that is not a day is left out. */
export const dayRangeToQuery = (from: string, to: string): { since?: string; until?: string } => {
  const since = from ? parseDay(from) : null;
  const end = to ? parseDay(to) : null;
  end?.setDate(end.getDate() + 1);
  return {
    ...(since ? { since: since.toISOString() } : {}),
    ...(end ? { until: end.toISOString() } : {}),
  };
};

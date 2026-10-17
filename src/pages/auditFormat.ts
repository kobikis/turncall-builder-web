// Pure helpers behind the Audit log page: how a JSON Pointer, a resource type
// and a day range read. Kept out of the component so they're testable alone.

/** What the API shows in place of a secret's value, on both sides of a change. */
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
  skill: "Skill",
  linked_repo: "Linked repo",
  compliance: "Compliance",
};

/** A resource type as a reader says it; an unknown one (a newer API, or one
 *  of TurnCall's) reads with its underscores turned to spaces. */
export const resourceLabel = (type: string): string =>
  RESOURCE_LABELS[type] ?? type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** An inclusive local `YYYY-MM-DD` range as the API's `since` (inclusive) and
 *  `until` (exclusive) instants: midnight starting `from`, and midnight ending
 *  `to`. Local, as every day filter in the console is (see dates.ts). */
export const dayRangeToQuery = (from: string, to: string): { since?: string; until?: string } => {
  const midnight = (day: string, plusDays = 0) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, m - 1, d + plusDays).toISOString();
  };
  return {
    ...(from ? { since: midnight(from) } : {}),
    ...(to ? { until: midnight(to, 1) } : {}),
  };
};

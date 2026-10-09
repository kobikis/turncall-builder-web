// A campaign's target list from CSV (#67), checked against TurnCall's own
// bounds (turncall#229) so a bad row is named before anything is sent.
// Header: a `number` column, an optional `timezone`, every other column a
// variable rendered into the agent's prompt as {{name}}. No header: one
// number per line.

export type Target = { number: string; timezone?: string; variables: Record<string, string> };
export type RowError = { row: number; message: string };

const E164 = /^\+[1-9]\d{1,14}$/;
// TurnCall's MAX_TARGET_VARIABLES / MAX_TARGET_VARIABLES_CHARS.
const MAX_VARIABLES = 50;
const MAX_VARIABLE_CHARS = 4096;
// MAX_TARGETS: one request carries the whole list.
export const MAX_TARGETS = 10_000;

/** Whether the browser knows `zone` as an IANA name — TurnCall takes no other. */
export function isTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// One CSV line: commas split, double quotes protect, "" is a quote.
// ponytail: no newlines inside a quoted value; a spreadsheet export rarely has one.
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") out.push(cur.trim()), (cur = "");
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function problem(t: Target, seen: Set<string>, defaultTimezone: string): string | null {
  if (!E164.test(t.number)) return `${t.number} is not an E.164 number (e.g. +15551234567)`;
  if (seen.has(t.number)) return `${t.number} is listed twice`;
  if (!t.timezone && !defaultTimezone) return "no timezone, and the campaign sets none";
  if (t.timezone && !isTimezone(t.timezone)) return `${t.timezone} is not an IANA timezone (e.g. America/New_York)`;
  const names = Object.keys(t.variables);
  if (names.length > MAX_VARIABLES) return `${names.length} variables; a target takes at most ${MAX_VARIABLES}`;
  const size = names.reduce((n, k) => n + k.length + t.variables[k].length, 0);
  if (size > MAX_VARIABLE_CHARS) return `variables total ${size} characters; the most is ${MAX_VARIABLE_CHARS}`;
  return null;
}

/** `rows[i]` is the CSV line `targets[i]` came from, to name a row TurnCall refuses. */
export function parseTargets(
  text: string,
  defaultTimezone: string,
): { targets: Target[]; rows: number[]; errors: RowError[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const header = cells(lines[0] ?? "").map((h) => h.toLowerCase());
  const hasHeader = header.includes("number");
  const columns = hasHeader ? cells(lines[0]) : ["number"];
  const targets: Target[] = [];
  const rows: number[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();

  lines.forEach((line, i) => {
    if (!line || (hasHeader && i === 0)) return;
    const values = cells(line);
    const target: Target = { number: "", variables: {} };
    columns.forEach((col, c) => {
      const value = values[c] ?? "";
      const key = col.toLowerCase();
      if (key === "number") target.number = value;
      else if (key === "timezone") value && (target.timezone = value);
      else if (value) target.variables[col] = value;
    });
    const message = problem(target, seen, defaultTimezone);
    seen.add(target.number);
    if (message) errors.push({ row: i + 1, message });
    else if (targets.length >= MAX_TARGETS) errors.push({ row: i + 1, message: `past ${MAX_TARGETS} targets, the most one campaign takes` });
    else targets.push(target), rows.push(i + 1);
  });
  return { targets, rows, errors };
}

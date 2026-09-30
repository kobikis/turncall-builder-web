/** Pure helpers behind the call detail: how an ended reason reads, where a
 * transcript entry sits on the call's timeline, and how a recording becomes a
 * waveform. Kept out of the components so each is checked without a DOM. */

export const fmtDuration = (ms: number | null) => {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// TurnCall's ended_reason values (ADR-0008), as a person would say them.
const ENDED_REASONS: Record<string, string> = {
  customer_ended_call: "Customer ended the call",
  assistant_ended_call: "Agent ended the call",
  customer_did_not_answer: "Customer did not answer",
  customer_busy: "Customer was busy",
  customer_silent: "Customer went silent",
  voicemail: "Reached voicemail",
  transferred: "Transferred",
  max_duration_reached: "Maximum duration reached",
  pipeline_error: "Agent error",
  telephony_failed: "Telephony failed",
  unknown: "Unknown",
};

// The endings a call is supposed to have — voicemail included, since reaching
// one is an expected outcome of an outbound call. Everything else — an error, a
// caller who never answered or went silent, the duration cap — is flagged.
const GOOD_ENDINGS = new Set([
  "customer_ended_call",
  "assistant_ended_call",
  "transferred",
  "voicemail",
]);

export const endedReasonTone = (reason: string | null | undefined): "good" | "bad" | null =>
  reason ? (GOOD_ENDINGS.has(reason) ? "good" : "bad") : null;

export const endedReasonLabel = (reason: string | null | undefined): string | null =>
  reason ? ENDED_REASONS[reason] ?? reason.replace(/_/g, " ") : null;

export const offsetSeconds = (
  at: string | null | undefined,
  startedAt: string | null | undefined
): number | null => {
  if (!at || !startedAt) return null;
  const s = (Date.parse(at) - Date.parse(startedAt)) / 1000;
  return Number.isFinite(s) && s >= 0 ? s : null;
};

/** `+MM:SS.hh` from the start of the call, or null when it can't be placed. */
export const offsetLabel = (
  at: string | null | undefined,
  startedAt: string | null | undefined
): string | null => {
  const s = offsetSeconds(at, startedAt);
  if (s == null) return null;
  const hundredths = Math.round(s * 100);
  const mm = Math.floor(hundredths / 6000);
  const ss = Math.floor((hundredths % 6000) / 100);
  const hh = hundredths % 100;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `+${pad(mm)}:${pad(ss)}.${pad(hh)}`;
};

export type Track = { label: string; samples: Float32Array };

/** A stereo recording is caller left, agent right (TurnCall #178); anything
 * older is a mono mix of both. */
export const tracksOf = (channels: Float32Array[]): Track[] =>
  channels.length >= 2
    ? [
        { label: "Caller", samples: channels[0] },
        { label: "Agent", samples: channels[1] },
      ]
    : channels.map((samples) => ({ label: "Call", samples }));

/** The loudest absolute sample in each of `buckets` equal slices. */
export function peaks(samples: Float32Array, buckets: number): number[] {
  const n = Math.min(buckets, samples.length);
  const size = samples.length / n;
  const out: number[] = [];
  for (let b = 0; b < n; b++) {
    let max = 0;
    const end = Math.floor((b + 1) * size);
    for (let i = Math.floor(b * size); i < end; i++) max = Math.max(max, Math.abs(samples[i]));
    out.push(max);
  }
  return out;
}

export type TranscriptEntry = { role: string | null; text: string; timestamp?: string };

/** One tool the call ran, as TurnCall records it (`/v1/tools/invocations`). */
export type ToolInvocation = {
  id: string;
  tool_name: string;
  status: string;
  latency_ms: number | null;
  created_at: string;
  input_json: unknown;
  output_json: unknown;
};

export type TimelineItem =
  | { kind: "line"; entry: TranscriptEntry; at?: string }
  | { kind: "tool"; tool: ToolInvocation; at: string };

/** Transcript lines and tool calls in the order they happened. A tool row is
 * written when the tool *finishes*, so it is placed at its start: the record
 * time less its latency. The sort is stable, so lines keep their own order. */
export function timeline(entries: TranscriptEntry[], tools: ToolInvocation[]): TimelineItem[] {
  const toolItems: TimelineItem[] = tools.map((tool) => ({
    kind: "tool",
    tool,
    at: new Date(Date.parse(tool.created_at) - (tool.latency_ms ?? 0)).toISOString(),
  }));
  const lineItems: TimelineItem[] = entries.map((entry) => ({ kind: "line", entry, at: entry.timestamp }));
  const ms = (i: TimelineItem) => (i.at ? Date.parse(i.at) : Number.POSITIVE_INFINITY);
  return [...lineItems, ...toolItems].sort((a, b) => ms(a) - ms(b));
}

/** Tool data for reading: indented JSON, and a string that is itself JSON
 * (a webhook that answered with a JSON body as text) unwrapped first. */
export function prettyJson(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

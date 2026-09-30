/** Pure helpers behind the call detail: how an ended reason reads, where a
 * transcript entry sits on the call's timeline, and how a recording becomes a
 * waveform. Kept out of the components so each is checked without a DOM. */

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

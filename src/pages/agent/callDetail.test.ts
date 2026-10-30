import { describe, expect, it } from "vitest";
import {
  capabilitiesHint,
  capabilityLoadedLabel,
  endedReasonLabel,
  endedReasonTone,
  offsetLabel,
  offsetSeconds,
  peaks,
  prettyJson,
  timeline,
  tracksOf,
} from "./callDetail";

describe("endedReasonLabel", () => {
  it("reads a known reason as a sentence", () => {
    expect(endedReasonLabel("customer_ended_call")).toBe("Customer ended the call");
    expect(endedReasonLabel("assistant_ended_call")).toBe("Agent ended the call");
  });
  it("falls back to the raw value for one it does not know", () => {
    expect(endedReasonLabel("brand_new_reason")).toBe("brand new reason");
  });
  it("is null while the call has no reason", () => {
    expect(endedReasonLabel(null)).toBeNull();
  });
});

describe("offsets from call start", () => {
  const start = "2026-09-30T12:41:49.000Z";
  it("formats minutes, seconds and hundredths", () => {
    expect(offsetLabel("2026-09-30T12:42:06.010Z", start)).toBe("+00:17.01");
    expect(offsetLabel("2026-09-30T12:43:15.500Z", start)).toBe("+01:26.50");
  });
  it("has none without a start, a timestamp, or before the start", () => {
    expect(offsetLabel("2026-09-30T12:42:06Z", null)).toBeNull();
    expect(offsetLabel(undefined, start)).toBeNull();
    expect(offsetLabel("2026-09-30T12:41:00Z", start)).toBeNull();
  });
  it("gives seconds for seeking", () => {
    expect(offsetSeconds("2026-09-30T12:42:06.010Z", start)).toBeCloseTo(17.01);
  });
});

describe("waveform", () => {
  it("names two channels caller and agent, and one channel the call", () => {
    const ch = (n: number) => new Float32Array(n);
    expect(tracksOf([ch(4), ch(4)]).map((t) => t.label)).toEqual(["Caller", "Agent"]);
    expect(tracksOf([ch(4)]).map((t) => t.label)).toEqual(["Call"]);
  });
  it("reduces samples to one peak per bucket", () => {
    const s = new Float32Array([0.1, -0.5, 0.2, 0.9, 0, 0, -0.3, 0.1]);
    expect(peaks(s, 4)).toEqual([0.5, 0.9, 0, 0.3].map((v) => Math.fround(v)));
  });
  it("never produces more buckets than samples", () => {
    expect(peaks(new Float32Array([0.5, 0.25]), 10)).toHaveLength(2);
  });
});

describe("endedReasonTone", () => {
  it("is good when the call ended the way calls should", () => {
    for (const r of ["customer_ended_call", "assistant_ended_call", "transferred", "voicemail"])
      expect(endedReasonTone(r)).toBe("good");
  });
  it("is bad for everything else, including a reason it does not know", () => {
    for (const r of ["pipeline_error", "telephony_failed", "customer_silent", "unknown", "brand_new"])
      expect(endedReasonTone(r)).toBe("bad");
  });
  it("has no tone while the call has no reason", () => {
    expect(endedReasonTone(null)).toBeNull();
  });
});

describe("timeline", () => {
  const line = (text: string, timestamp: string) => ({ role: "assistant", text, timestamp });
  const tool = (tool_name: string, created_at: string, latency_ms: number | null) => ({
    id: tool_name,
    tool_name,
    created_at,
    latency_ms,
    status: "succeeded",
    input_json: {},
    output_json: {},
  });

  it("places a tool call where it started, among the lines", () => {
    const items = timeline(
      [line("checking", "2026-09-30T10:00:05Z"), line("booked", "2026-09-30T10:00:12Z")],
      // recorded when it finished (10:00:10), after running 3s: it started at 10:00:07
      [tool("book_table", "2026-09-30T10:00:10Z", 3000)]
    );
    expect(items.map((i) => (i.kind === "line" ? i.entry.text : i.tool.tool_name))).toEqual([
      "checking",
      "book_table",
      "booked",
    ]);
    const t = items[1];
    expect(t.kind === "tool" && t.at).toBe("2026-09-30T10:00:07.000Z");
  });

  it("keeps lines in their own order and a tool without latency at its record time", () => {
    const items = timeline(
      [line("a", "2026-09-30T10:00:01Z"), line("b", "2026-09-30T10:00:03Z")],
      [tool("lookup", "2026-09-30T10:00:02Z", null)]
    );
    expect(items.map((i) => i.kind)).toEqual(["line", "tool", "line"]);
  });
});

describe("prettyJson", () => {
  it("indents objects and unwraps a string that is itself JSON", () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(prettyJson('{"ok":true}')).toBe('{\n  "ok": true\n}');
  });
  it("leaves plain text alone and shows null as a dash", () => {
    expect(prettyJson("no json here")).toBe("no json here");
    expect(prettyJson(null)).toBe("—");
  });
});

it("a Capability's load reads loaded, not loaded, or unknown when the events expired", () => {
  expect(capabilityLoadedLabel(true)).toBe("Loaded");
  expect(capabilityLoadedLabel(false)).toBe("Not loaded");
  expect(capabilityLoadedLabel(null)).toBe("Unknown");
  expect(capabilitiesHint([{ loaded: true }, { loaded: false }])).toBe("1 of 2 loaded");
  expect(capabilitiesHint([{ loaded: true }, { loaded: null }])).toBe("2 · loads unknown");
});

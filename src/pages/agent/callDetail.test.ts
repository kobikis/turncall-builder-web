import { describe, expect, it } from "vitest";
import { endedReasonLabel, offsetLabel, offsetSeconds, peaks, tracksOf } from "./callDetail";

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

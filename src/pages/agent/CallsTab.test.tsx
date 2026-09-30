// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The call detail, driven through the Calls tab the way a person opens it:
// the list loads, a row expands, and each section reads its own endpoint.

const START = new Date(Date.now() - 60_000);
const at = (secs: number) => new Date(START.getTime() + secs * 1000).toISOString();

let calls: Record<string, unknown>[] = [];
let transcript: unknown[] = [];
let events: unknown[] = [];
const requested: string[] = [];

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string) => {
    requested.push(path);
    if (path.endsWith("/calls")) return { data: calls };
    if (path.endsWith("/transcript")) return { data: { entries: transcript } };
    if (path.includes("/events")) return { data: events };
    return { data: {} };
  }),
  getActiveWorkspaceId: () => "w1",
  ApiError: class ApiError extends Error {},
}));
vi.mock("./AgentPage", () => ({ useAgent: () => ({ agentId: "a1", data: {} }) }));

import CallsTab from "./CallsTab";

const call = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  direction: "inbound",
  from_number: null,
  to_number: null,
  provider_call_sid: "webrtc",
  status: "completed",
  started_at: START.toISOString(),
  duration_ms: 47000,
  recording_status: "none",
  analysis: null,
  ended_reason: "customer_ended_call",
  agent_name: "Riley",
  agent_version: 1,
  latency_summary: null,
  ...over,
});

beforeEach(() => {
  calls = [call()];
  transcript = [];
  events = [];
});

afterEach(() => {
  requested.length = 0;
  cleanup();
});

async function openCall() {
  render(<CallsTab />);
  const toggle = await screen.findByRole("button", { name: /Expand call/ });
  fireEvent.click(toggle);
}

// ---- #50: header + transcript offsets ---------------------------------------

it("the open call says why it ended and which agent version ran it", async () => {
  await openCall();
  expect(await screen.findByText("Customer ended the call")).toBeDefined();
  expect(screen.getByText("Riley")).toBeDefined();
  expect(screen.getByText("v1")).toBeDefined();
});

it("an inline-agent call shows no agent line rather than a placeholder", async () => {
  calls = [call({ agent_name: null, agent_version: null })];
  await openCall();
  await screen.findByText("Customer ended the call");
  expect(screen.queryByText(/^Agent:/)).toBeNull();
  expect(screen.queryByText("v")).toBeNull();
});

it("each transcript entry carries its offset from the start of the call", async () => {
  transcript = [
    { role: "assistant", text: "How may I help?", timestamp: at(17.01) },
    { role: "customer", text: "Thank you. Bye.", timestamp: at(26.69) },
  ];
  await openCall();
  expect(await screen.findByText("+00:17.01")).toBeDefined();
  expect(screen.getByText("+00:26.69")).toBeDefined();
});

it("an entry that cannot be placed on the timeline shows no offset", async () => {
  calls = [call({ started_at: START.toISOString() })];
  transcript = [{ role: "customer", text: "early", timestamp: at(-5) }];
  await openCall();
  await screen.findByText("early");
  expect(screen.queryByText(/^\+\d/)).toBeNull();
});

// ---- #51: recording timeline ------------------------------------------------

function stubAudio(channels: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob([new Uint8Array(64)]), { status: 200 }))
  );
  URL.createObjectURL = vi.fn(() => "blob:rec");
  URL.revokeObjectURL = vi.fn();
  class FakeAudioContext {
    async decodeAudioData() {
      return {
        numberOfChannels: channels,
        getChannelData: (i: number) => new Float32Array(480).fill(i === 0 ? 0.5 : -0.25),
      };
    }
    close() {}
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
}

afterEach(() => vi.unstubAllGlobals());

it("a stereo recording draws the caller and the agent as two waveforms", async () => {
  stubAudio(2);
  calls = [call({ recording_status: "completed" })];
  await openCall();
  expect(await screen.findByLabelText(/Caller waveform/)).toBeDefined();
  expect(screen.getByLabelText(/Agent waveform/)).toBeDefined();
});

it("an older mono recording draws one waveform", async () => {
  stubAudio(1);
  calls = [call({ recording_status: "completed" })];
  await openCall();
  expect(await screen.findByLabelText(/Call waveform/)).toBeDefined();
  expect(screen.queryByLabelText(/Caller waveform/)).toBeNull();
});

it("clicking a transcript entry jumps the recording to it", async () => {
  stubAudio(2);
  calls = [call({ recording_status: "completed" })];
  transcript = [{ role: "customer", text: "Thank you. Bye.", timestamp: at(26.69) }];
  await openCall();
  await screen.findByLabelText(/Caller waveform/);
  const audio = document.querySelector("audio") as HTMLAudioElement;
  let t = 0;
  Object.defineProperty(audio, "currentTime", { get: () => t, set: (v) => (t = v) });
  fireEvent.click(screen.getByRole("button", { name: "Thank you. Bye." }));
  expect(t).toBeCloseTo(26.69);
});

it("leaves play, speed and download to the browser's own player", async () => {
  stubAudio(2);
  calls = [call({ recording_status: "completed" })];
  await openCall();
  await screen.findByLabelText(/Caller waveform/);
  expect(document.querySelector("audio")?.hasAttribute("controls")).toBe(true);
  expect(screen.queryByLabelText("Playback speed")).toBeNull();
  expect(screen.queryByText("Download")).toBeNull();
});

// ---- #52: latency ------------------------------------------------------------

const turn = (n: number, ms: number, stages: Record<string, number>) => ({
  event_type: "metrics.turn",
  payload: {
    turn: n,
    user_to_bot_ms: ms,
    stages: Object.fromEntries(
      Object.entries(stages).map(([k, v]) => [k, { ttfb_ms: v, service: k }])
    ),
  },
});

const summary = {
  turns: 2,
  user_to_bot: { p50_ms: 900, p95_ms: 1500, count: 2 },
  stages: { llm: { p50_ms: 300, p95_ms: 420, count: 2 } },
  slowest_turn: { turn: 2, user_to_bot_ms: 1500 },
};

it("latency shows the summary and one row per turn", async () => {
  calls = [call({ latency_summary: summary })];
  events = [turn(1, 900, { llm: 300 }), turn(2, 1500, { llm: 420 })];
  await openCall();
  const section = await screen.findByRole("region", { name: "Latency" });
  expect(within(section).getByText("p50 900 ms")).toBeDefined();
  await waitFor(() => expect(within(section).getAllByRole("row")).toHaveLength(3));
  expect(requested).toContain("/agents/a1/calls/c1/events?event_type=metrics.turn");
});

it("the slowest turn is marked", async () => {
  calls = [call({ latency_summary: summary })];
  events = [turn(1, 900, { llm: 300 }), turn(2, 1500, { llm: 420 })];
  await openCall();
  const slow = await screen.findByText("slowest");
  expect(slow.closest("tr")?.textContent).toContain("1500");
});

it("a stage the call never had is blank, not zero", async () => {
  calls = [call({ latency_summary: summary })];
  events = [turn(1, 900, { llm: 300 })];
  await openCall();
  const section = await screen.findByRole("region", { name: "Latency" });
  await waitFor(() => expect(within(section).getAllByRole("row")).toHaveLength(2));
  const cells = within(section).getAllByRole("row")[1].querySelectorAll("td");
  expect(Array.from(cells).map((c) => c.textContent)).toEqual(["1", "—", "300", "—", "900"]);
});

it("no measured turns says so instead of showing zeros", async () => {
  calls = [call({ latency_summary: null })];
  await openCall();
  expect(await screen.findByText("No latency measured for this call.")).toBeDefined();
  expect(requested.some((p) => p.includes("/events"))).toBe(false);
});

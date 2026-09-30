// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The call detail, driven through the Calls tab the way a person opens it:
// the list loads, a row expands, and each section reads its own endpoint.

const START = new Date(Date.now() - 60_000);
const at = (secs: number) => new Date(START.getTime() + secs * 1000).toISOString();

let calls: Record<string, unknown>[] = [];
let transcript: unknown[] = [];
let events: unknown[] = [];
let context: unknown = { status: "not_captured", segments: [] };
const requested: string[] = [];

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string) => {
    requested.push(path);
    if (path.endsWith("/calls")) return { data: calls };
    if (path.endsWith("/transcript")) return { data: { entries: transcript } };
    if (path.includes("/events")) return { data: events };
    if (path.endsWith("/context")) return { data: context };
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
  context = { status: "not_captured", segments: [] };
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

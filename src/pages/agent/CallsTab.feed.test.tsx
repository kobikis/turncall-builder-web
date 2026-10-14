// @vitest-environment jsdom
//
// Live events are one call's: the open call, else the newest. The backend
// keeps every event it ever received, and since it hears every event type
// (builder-api#94) one list of all of them stopped being readable.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const requested: string[] = [];
const ev = (event: string, call_id: string | null, n: number) => ({
  event, call_id, event_id: `${event}-${call_id}-${n}`, timestamp: "2026-10-12T17:40:00Z",
});
// What a backend generated before `?call_id=` answers: everything.
const stored = [
  ev("call.started", "old", 1),
  ev("transcript.final", "old", 2),
  ev("call.rejected", null, 3),
  ev("call.started", "new", 4),
  ev("tool.result", "new", 5),
];
const calls = [
  { id: "old", started_at: "2026-10-12T17:00:00Z", status: "completed", direction: "inbound" },
  { id: "new", started_at: "2026-10-12T17:40:00Z", status: "in_progress", direction: "inbound" },
];

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string) => {
    requested.push(path);
    if (path.endsWith("/calls")) return { data: calls };
    if (path.startsWith("/relay/events")) return { data: { events: stored } };
    return { data: {} };
  }),
  getActiveWorkspaceId: () => "w1",
  ApiError: class ApiError extends Error {},
}));
vi.mock("../../auth", () => ({ useAuth: () => ({ activeWorkspace: { role: "editor" } }) }));
vi.mock("./AgentPage", () => ({
  useAgent: () => ({ agentId: "a1", data: { backend: { browser_url: "/relay" } } }),
}));

import CallsTab from "./CallsTab";

// The calls list opens on today, so the fixture's day has to be today. Only
// Date is faked: the findBy* polling still runs on real timers.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T18:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  requested.length = 0;
  cleanup();
});

const feed = () => Array.from(document.querySelectorAll(".event-row summary code")).map((e) => e.textContent);

it("follows the newest call, then the one opened", async () => {
  render(<CallsTab />);
  await screen.findByText("tool.result");
  expect(feed()).toEqual(["call.started", "tool.result"]);
  expect(requested).toContain("/relay/events?call_id=new");

  const rows = await screen.findAllByRole("button", { name: /Expand call/ });
  // Newest first: the second row is the older call.
  fireEvent.click(rows[1]);
  await screen.findByText("transcript.final");
  expect(feed()).toEqual(["call.started", "transcript.final"]);
  expect(requested).toContain("/relay/events?call_id=old");
});

it("a row reads time first, and opening it shows the whole event", async () => {
  render(<CallsTab />);
  const row = (await screen.findByText("tool.result")).closest("details")!;
  const summary = row.querySelector("summary")!;
  expect(summary.firstElementChild?.tagName).toBe("SPAN"); // the time, then the type
  expect((row as HTMLDetailsElement).open).toBe(false);
  fireEvent.click(summary);
  expect((row as HTMLDetailsElement).open).toBe(true);
  expect(row.querySelector(".event-data")?.textContent).toContain('"event_id": "tool.result-new-5"');
});

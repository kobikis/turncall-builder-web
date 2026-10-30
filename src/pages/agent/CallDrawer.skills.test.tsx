// @vitest-environment jsdom
//
// A call's skills (#128): which the call could load, at which version,
// and which it did — from `skills` on TurnCall's call read.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string) => {
    if (path.endsWith("/transcript")) return { data: { entries: [] } };
    return { data: [] };
  }),
  getActiveWorkspaceId: () => "w1",
}));

import CallDrawer from "./CallDrawer";
import type { Call } from "../../types";

const call = (over: Partial<Call> = {}): Call => ({
  id: "c1", direction: "inbound", from_number: null, to_number: null, provider_call_sid: "webrtc",
  status: "completed", started_at: new Date().toISOString(), duration_ms: 1000, recording_status: "none",
  analysis: null, ended_reason: "customer_ended_call", agent_name: "Riley", agent_version: 1,
  latency_summary: null, ...over,
});

const open = (c: Call) =>
  render(
    <MemoryRouter>
      <CallDrawer agentId="a1" call={c} />
    </MemoryRouter>,
  );

afterEach(cleanup);

it("a call that loaded a skill shows it loaded, with the version it ran", () => {
  open(call({
    skills: [
      { skill: "verify_caller", version: 3, pinned: false, loaded: true },
      { skill: "explain_bill", version: 1, pinned: true, loaded: false },
    ],
  }));
  const section = screen.getByRole("group", { name: "Skills" });
  expect(section.textContent).toMatch(/1 of 2 loaded/);

  const verify = within(section).getByRole("row", { name: "Skill verify_caller" });
  expect(within(verify).getByText("v3")).toBeTruthy();
  expect(within(verify).getByText("Loaded")).toBeTruthy();
  expect(within(verify).getByRole("link", { name: "verify_caller" }).getAttribute("href")).toBe("/skills/verify_caller");

  const bill = within(section).getByRole("row", { name: "Skill explain_bill" });
  expect(bill.textContent).toMatch(/v1 · pinned/);
  expect(within(bill).getByText("Not loaded")).toBeTruthy();
});

it("a call with no skills shows nothing extra", () => {
  open(call({ skills: [] }));
  expect(screen.queryByRole("group", { name: "Skills" })).toBeNull();
  cleanup();
  open(call()); // a TurnCall that predates the field
  expect(screen.queryByRole("group", { name: "Skills" })).toBeNull();
});

it("an unknown load (the call's events expired) reads as unknown, not as not loaded", () => {
  open(call({ skills: [{ skill: "verify_caller", version: 2, pinned: false, loaded: null }] }));
  const row = screen.getByRole("row", { name: "Skill verify_caller" });
  expect(within(row).getByText("Unknown")).toBeTruthy();
  expect(within(row).queryByText("Not loaded")).toBeNull();
  expect(screen.getByRole("group", { name: "Skills" }).textContent).toMatch(/loads unknown/);
});

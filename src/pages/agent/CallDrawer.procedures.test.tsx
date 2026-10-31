// @vitest-environment jsdom
//
// A call's procedures (#130): each one's path, where it ended — completed,
// escalated, or left — and the moves refused, from `procedures` on
// TurnCall's call read (turncall#443).
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
import type { Call, CallProcedure } from "../../types";

const call = (procedures?: CallProcedure[] | null): Call => ({
  id: "c1", direction: "inbound", from_number: null, to_number: null, provider_call_sid: "webrtc",
  status: "completed", started_at: new Date().toISOString(), duration_ms: 1000, recording_status: "none",
  analysis: null, ended_reason: "customer_ended_call", agent_name: "Riley", agent_version: 1,
  latency_summary: null, procedures,
});

const open = (c: Call) =>
  render(
    <MemoryRouter>
      <CallDrawer agentId="a1" call={c} />
    </MemoryRouter>,
  );

afterEach(cleanup);

it("shows each procedure's path and how it ended", () => {
  open(call([
    { name: "triage", path: ["greet", "check", "greet", "check", "done"], completed: true, ended_at: "done", escalated_at: null, refused_moves: 0 },
    { name: "outage", path: ["greet", "operator"], completed: false, ended_at: "operator", escalated_at: "operator", refused_moves: 2 },
    { name: "billing", path: ["ask_account"], completed: false, ended_at: "ask_account", escalated_at: null, refused_moves: 1 },
  ]));
  const section = screen.getByRole("group", { name: "Procedures" });
  expect(section.textContent).toMatch(/1 of 3 completed/);

  const triage = within(section).getByRole("row", { name: "Procedure triage" });
  expect(triage.textContent).toMatch(/greet → check → greet → check → done/);
  expect(within(triage).getByText("Completed")).toBeTruthy();

  const outage = within(section).getByRole("row", { name: "Procedure outage" });
  expect(within(outage).getByText("Escalated at operator")).toBeTruthy();
  expect(outage.textContent).toMatch(/2 refused/);

  const billing = within(section).getByRole("row", { name: "Procedure billing" });
  expect(within(billing).getByText("Left at ask_account")).toBeTruthy();
  expect(billing.textContent).toMatch(/1 refused/);
});

it("a call with no procedures shows nothing extra", () => {
  open(call([]));
  expect(screen.queryByRole("group", { name: "Procedures" })).toBeNull();
  cleanup();
  open(call()); // a TurnCall that predates the field
  expect(screen.queryByRole("group", { name: "Procedures" })).toBeNull();
});

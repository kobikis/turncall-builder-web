// @vitest-environment jsdom
//
// The Workspace's compliance settings (#97): admin-only, saved whole, and
// written into every agent with each one's state shown.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Role } from "../types";

const DEFAULTS = ["PHONE_NUMBER", "EMAIL_ADDRESS", "CREDIT_CARD", "US_SSN", "IBAN_CODE"];
const SUPPORTED = [...DEFAULTS, "PERSON", "LOCATION"].sort();

const applied = { state: "applied", error: null };
const report = (over: Record<string, unknown> = {}) => ({
  set: false,
  updated_at: null,
  redaction: { enabled: false, entities: null },
  retention: { recordings_days: null, transcripts_days: null, events_days: null },
  agents: [{ agent_id: "a1", name: "Front desk", ...applied, overridden: false, effective: {} }],
  webhook_numbers: null,
  complete: true,
  entity_types: { supported: SUPPORTED, default: DEFAULTS },
  ...over,
});

const calls: { path: string; method?: string; body?: unknown }[] = [];
let current: ReturnType<typeof report> = report();
let afterApply: ReturnType<typeof report> | null = null;
let refuse = "";
let role: Role = "admin";

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (init?.method === "PUT") {
      if (refuse) throw new Error(refuse);
      const body = JSON.parse(String(init.body));
      current = report({ ...body, set: true, updated_at: "2026-10-17T10:00:00Z" });
    }
    if (path === "/compliance/apply" && afterApply) current = afterApply;
    return { data: current };
  }),
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ loading: false, activeWorkspace: { role } }),
}));

import Compliance from "./Compliance";
import { RequireRole } from "../App";

afterEach(() => {
  calls.length = 0;
  current = report();
  afterApply = null;
  refuse = "";
  role = "admin";
  cleanup();
});

const page = () =>
  render(
    <MemoryRouter>
      <Compliance />
    </MemoryRouter>,
  );
const loaded = () => waitFor(() => expect(calls.some((c) => c.path === "/compliance")).toBe(true));
const box = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: /save compliance settings/i }));
const put = () => calls.find((c) => c.method === "PUT");

it("says plainly that redaction never changes what the agent hears, and that audio is not redacted", async () => {
  page();
  await loaded();
  expect(screen.getByText(/never changes what the agent hears/i)).toBeTruthy();
  expect(screen.getByText(/text only: the recording is not bleeped/i)).toBeTruthy();
  expect(screen.getByText(/not set yet/i)).toBeTruthy();
});

it("an admin turns redaction on with an extra type and a recordings period, and saves", async () => {
  page();
  await loaded();
  await waitFor(() => expect(box(/redact personal details/i).disabled).toBe(false));
  fireEvent.click(box(/redact personal details/i));
  // The default set is preselected; the rest are opt-in.
  for (const e of DEFAULTS) expect(box(e).checked).toBe(true);
  expect(box("PERSON").checked).toBe(false);
  fireEvent.click(box("PERSON"));

  fireEvent.click(box(/keep recordings for good/i));
  fireEvent.change(screen.getByLabelText(/recordings \(days\)/i), { target: { value: "30" } });
  save();

  await waitFor(() => expect(put()).toBeTruthy());
  expect(put()!.path).toBe("/compliance");
  expect(put()!.body).toEqual({
    redaction: { enabled: true, entities: [...DEFAULTS, "PERSON"].sort() },
    retention: { recordings_days: 30, transcripts_days: null, events_days: null },
  });
  expect((await screen.findByRole("status")).textContent).toMatch(/written into every agent/i);
  expect(screen.queryByText(/not set yet/i)).toBeNull();
});

it("the default set exactly is sent as null, so it keeps following the engine's default", async () => {
  page();
  await loaded();
  await waitFor(() => expect(box(/redact personal details/i).disabled).toBe(false));
  fireEvent.click(box(/redact personal details/i));
  save();
  await waitFor(() => expect(put()).toBeTruthy());
  expect((put()!.body as { redaction: unknown }).redaction).toEqual({ enabled: true, entities: null });
});

it("refuses a bad period or an empty type list before sending, and shows the server's reason", async () => {
  page();
  await loaded();
  await waitFor(() => expect(box(/redact personal details/i).disabled).toBe(false));

  fireEvent.click(box(/keep events for good/i));
  save();
  expect((await screen.findByRole("alert")).textContent).toMatch(/events: enter a number of days/i);
  fireEvent.change(screen.getByLabelText(/events \(days\)/i), { target: { value: "0" } });
  save();
  expect(screen.getByRole("alert").textContent).toMatch(/whole number of days from 1 to 36500/);
  fireEvent.change(screen.getByLabelText(/events \(days\)/i), { target: { value: "90" } });

  fireEvent.click(box(/redact personal details/i));
  for (const e of DEFAULTS) fireEvent.click(box(e));
  save();
  expect(screen.getByRole("alert").textContent).toMatch(/at least one entity type/i);
  expect(put()).toBeUndefined();

  fireEvent.click(box("PHONE_NUMBER"));
  refuse = "retention.events_days: Input should be less than or equal to 36500";
  save();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/less than or equal to 36500/));
});

it("36500 days reads as kept for good, as on every agent page, and saves as null", async () => {
  current = report({
    set: true,
    retention: { recordings_days: 30, transcripts_days: 36500, events_days: null },
  });
  page();
  await loaded();
  await waitFor(() => expect(box(/keep transcripts for good/i).checked).toBe(true));
  expect(box(/transcripts \(days\)/i).value).toBe("");
  expect(box(/transcripts \(days\)/i).placeholder).toBe("kept for good");
  expect(box(/keep events for good/i).checked).toBe(true);
  expect(box(/recordings \(days\)/i).value).toBe("30");
  // Typed rather than ticked, it means the same.
  fireEvent.change(box(/recordings \(days\)/i), { target: { value: "36500" } });
  save();
  await waitFor(() => expect(put()).toBeTruthy());
  expect((put()!.body as { retention: unknown }).retention).toEqual({
    recordings_days: null,
    transcripts_days: null,
    events_days: null,
  });
});

it("shows each agent's projection state with its reason, and retries the failures", async () => {
  current = report({
    set: true,
    complete: false,
    agents: [
      { agent_id: "a1", name: "Front desk", ...applied, overridden: false, effective: {} },
      { agent_id: "a2", name: "Billing", state: "failed", error: "TurnCall refused: 503", overridden: true, effective: {} },
      { agent_id: "a3", name: "Sales", state: "pending", error: null, overridden: false, effective: {} },
    ],
    webhook_numbers: { state: "applied", error: null },
  });
  afterApply = report({ set: true, complete: true, webhook_numbers: applied });
  page();
  expect(await screen.findByText("TurnCall refused: 503")).toBeTruthy();
  expect(screen.getByText("failed")).toBeTruthy();
  expect(screen.getByText("pending")).toBeTruthy();
  expect(screen.getByText("Its own override")).toBeTruthy();
  expect(screen.getByText("Custom call-init numbers")).toBeTruthy();
  expect((screen.getByRole("link", { name: "Billing" }) as HTMLAnchorElement).getAttribute("href")).toBe(
    "/agents/a2/build/compliance",
  );

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(calls.some((c) => c.path === "/compliance/apply" && c.method === "POST")).toBe(true));
  await waitFor(() => expect(screen.queryByText("TurnCall refused: 503")).toBeNull());
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("shows the audit log's own retention as the operator's, with no control for it", async () => {
  page();
  await loaded();
  expect(screen.getByText("AUDIT_LOG_RETENTION_DAYS")).toBeTruthy();
  const audit = screen.getByRole("region", { name: /audit log retention/i });
  expect(audit.querySelector("input, select, button")).toBeNull();
});

it("is not reachable by a non-admin", async () => {
  role = "editor";
  render(
    <MemoryRouter initialEntries={["/compliance"]}>
      <Routes>
        <Route path="/compliance" element={<RequireRole min="admin"><Compliance /></RequireRole>} />
        <Route path="/agents" element={<div>AGENTS</div>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText("AGENTS")).toBeTruthy();
  expect(calls).toHaveLength(0);
});

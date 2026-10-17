// @vitest-environment jsdom
//
// An agent's override of the Workspace's compliance settings (#97): redaction
// whole, retention field by field (blank = the Workspace's), admin-only.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Role } from "../../types";

const workspace = {
  set: true,
  updated_at: null,
  redaction: { enabled: true, entities: null },
  retention: { recordings_days: 30, transcripts_days: null, events_days: 365 },
};
type Override = { redaction: unknown; retention: Record<string, number | null> | null };
// What the API reports, not a list of the console's own: a type the console
// never heard of is offered, and one the API left out is not.
const ENTITY_TYPES = { supported: ["EMAIL_ADDRESS", "NEW_TYPE", "PHONE_NUMBER"], default: ["PHONE_NUMBER"] };

// What the API answers: the effective setting is the Workspace's, then the
// override (redaction whole, retention per non-null field).
const reportFor = (override: Override, projection = { state: "applied", error: null as string | null }) => ({
  workspace,
  override,
  effective: {
    redaction: override.redaction ?? workspace.redaction,
    retention: Object.fromEntries(
      Object.entries(workspace.retention).map(([k, v]) => [k, override.retention?.[k] ?? v]),
    ),
  },
  projection,
  entity_types: ENTITY_TYPES,
});

const calls: { path: string; method?: string; body?: unknown }[] = [];
let current = reportFor({ redaction: null, retention: null });
let afterApply: ReturnType<typeof reportFor> | null = null;
let role: Role = "admin";

vi.mock("../../api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method: init?.method, body });
    if (init?.method === "PUT") current = reportFor(body);
    if (path.endsWith("/compliance/apply")) {
      if (afterApply) current = afterApply;
    }
    return { data: current };
  }),
}));

vi.mock("../../auth", () => ({ useAuth: () => ({ activeWorkspace: { role } }) }));

import AgentCompliance from "./AgentCompliance";

afterEach(() => {
  calls.length = 0;
  current = reportFor({ redaction: null, retention: null });
  afterApply = null;
  role = "admin";
  cleanup();
});

const field = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const applies = () => screen.getByLabelText("What applies").textContent ?? "";
const put = () => calls.find((c) => c.method === "PUT");
const ready = () => waitFor(() => expect(field(/use the workspace's/i).disabled).toBe(false));

it("an inheriting agent shows the Workspace's setting as what applies", async () => {
  render(<AgentCompliance agentId="a1" />);
  await ready();
  expect(field(/use the workspace's/i).checked).toBe(true);
  expect(applies()).toMatch(/Redaction: On, the default types \(PHONE_NUMBER\) \(the Workspace's\)/);
  expect(applies()).toMatch(/Recordings: 30 days \(the Workspace's\)/);
  expect(applies()).toMatch(/Transcripts: kept for good/);
  expect(field(/recordings \(days\)/i).placeholder).toBe("Workspace: 30 days");
  expect(screen.getByText(/never what the agent hears/i)).toBeTruthy();
});

it("an admin overrides redaction whole and one retention field, leaving the others to the Workspace", async () => {
  render(<AgentCompliance agentId="a1" />);
  await ready();
  fireEvent.click(field(/override for this agent/i));
  // Overriding starts from the Workspace's setting.
  expect(field(/redact personal details/i).checked).toBe(true);
  expect(field("PHONE_NUMBER").checked).toBe(true);
  fireEvent.click(field(/redact personal details/i));
  fireEvent.change(field(/recordings \(days\)/i), { target: { value: "7" } });
  fireEvent.click(field(/keep transcripts for good/i));
  fireEvent.click(screen.getByRole("button", { name: /save override/i }));

  await waitFor(() => expect(put()).toBeTruthy());
  expect(put()!.path).toBe("/agents/a1/compliance");
  expect(put()!.body).toEqual({
    redaction: { enabled: false, entities: null },
    retention: { recordings_days: 7, transcripts_days: 36500, events_days: null },
  });
  await waitFor(() => expect(applies()).toMatch(/Redaction: Off \(this agent's\)/));
  expect(applies()).toMatch(/Recordings: 7 days \(this agent's\)/);
  expect(applies()).toMatch(/Transcripts: kept for good \(this agent's\)/);
  expect(applies()).toMatch(/Events: 365 days \(the Workspace's\)/);
});

it("offers the entity types the API reports, and no others", async () => {
  render(<AgentCompliance agentId="a1" />);
  await ready();
  fireEvent.click(field(/override for this agent/i));
  expect(field("NEW_TYPE").checked).toBe(false);
  expect(field("PHONE_NUMBER").checked).toBe(true); // the API's default set
  expect(screen.queryByLabelText("PERSON")).toBeNull();
  fireEvent.click(field("NEW_TYPE"));
  fireEvent.click(screen.getByRole("button", { name: /save override/i }));
  await waitFor(() => expect(put()).toBeTruthy());
  expect(put()!.body).toMatchObject({ redaction: { enabled: true, entities: ["NEW_TYPE", "PHONE_NUMBER"] } });
});

it("a kind kept for good says so, not the Workspace's value", async () => {
  current = reportFor({ redaction: null, retention: { recordings_days: 36500, transcripts_days: null, events_days: null } });
  render(<AgentCompliance agentId="a1" />);
  await ready();
  expect(field(/keep recordings for good/i).checked).toBe(true);
  expect(field(/recordings \(days\)/i).placeholder).toBe("kept for good");
  expect(field(/events \(days\)/i).placeholder).toBe("Workspace: 365 days");
});

it("going back to inherit clears the override", async () => {
  current = reportFor({ redaction: { enabled: false, entities: null }, retention: { recordings_days: 7, transcripts_days: null, events_days: null } });
  render(<AgentCompliance agentId="a1" />);
  await ready();
  expect(field(/override for this agent/i).checked).toBe(true);
  expect(field(/recordings \(days\)/i).value).toBe("7");
  fireEvent.click(field(/use the workspace's/i));
  fireEvent.change(field(/recordings \(days\)/i), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: /save override/i }));
  await waitFor(() => expect(put()).toBeTruthy());
  expect(put()!.body).toEqual({ redaction: null, retention: null });
});

it("refuses an out-of-range period before sending", async () => {
  render(<AgentCompliance agentId="a1" />);
  await ready();
  fireEvent.change(field(/events \(days\)/i), { target: { value: "40000" } });
  fireEvent.click(screen.getByRole("button", { name: /save override/i }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/events: a whole number of days from 1 to 36500/i);
  expect(put()).toBeUndefined();
});

it("a failed projection says why, and an admin retries this agent alone", async () => {
  current = reportFor({ redaction: null, retention: null }, { state: "failed", error: "TurnCall refused: 503" });
  afterApply = reportFor({ redaction: null, retention: null });
  render(<AgentCompliance agentId="a1" />);
  expect(await screen.findByText(/could not be written: TurnCall refused: 503/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect((await screen.findByRole("status")).textContent).toMatch(/written into this agent's project now/i);
  expect(applies()).toMatch(/Written into this agent's project\./);
  const posts = calls.filter((c) => c.method === "POST").map((c) => c.path);
  expect(posts).toEqual(["/agents/a1/compliance/apply"]); // never the Workspace's
});

it("a retry that fails again says so", async () => {
  const failed = reportFor({ redaction: null, retention: null }, { state: "failed", error: "TurnCall refused: 503" });
  current = failed;
  afterApply = failed;
  render(<AgentCompliance agentId="a1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  expect((await screen.findByRole("status")).textContent).toMatch(/still could not be written: TurnCall refused: 503/i);
});

it("a non-admin reads what applies but cannot override it", async () => {
  role = "editor";
  current = reportFor({ redaction: null, retention: null }, { state: "failed", error: "TurnCall refused: 503" });
  render(<AgentCompliance agentId="a1" />);
  await waitFor(() => expect(applies()).toMatch(/Recordings: 30 days/));
  expect(field(/use the workspace's/i).disabled).toBe(true);
  expect(field(/override for this agent/i).disabled).toBe(true);
  expect(field(/recordings \(days\)/i).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: /save override/i })).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getByText(/only an admin can override/i)).toBeTruthy();
});

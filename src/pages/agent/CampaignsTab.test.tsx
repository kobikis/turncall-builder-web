// @vitest-environment jsdom
//
// An agent's campaigns (#67): create, watch, pause, resume, cancel.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const sent: { path: string; init?: RequestInit }[] = [];
let campaigns: Record<string, unknown>[] = [];
let targets: Record<string, unknown>[] = [];
const COUNTS = { pending: 1, dialling: 0, placing: 0, calling: 1, completed: 2, suppressed: 0, failed: 1, cancelled: 0 };

vi.mock("../../api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(async (path: string, init?: RequestInit) => {
    sent.push({ path, init });
    if (path === "/phone-numbers")
      return { data: { phone_numbers: [{ id: "pn1", e164: "+15550001111", agent_id: "a1", routing_type: "agent" }] } };
    if (path.endsWith("/do-not-call") && !init)
      return { data: [{ id: "s1", number: "+15553334444", created_at: "2026-10-09T10:00:00Z" }], total: 1 };
    if (/\/campaigns\/c\d\/targets/.test(path)) return { data: targets, total: targets.length };
    if (/\/campaigns\/c\d$/.test(path)) return { data: campaigns[0] };
    if (path.startsWith("/agents/a1/campaigns") && !init) return { data: campaigns, total: campaigns.length };
    if (init?.method === "POST") return { data: { id: "c2", status: "queued" } };
    return { data: {} };
  }),
}));
vi.mock("../../auth", () => ({ useAuth: () => ({ activeWorkspace: { role: "editor" } }) }));
vi.mock("./AgentPage", () => ({ useAgent: () => ({ agentId: "a1", data: {} }) }));

import CampaignsTab from "./CampaignsTab";

const show = () =>
  render(
    <MemoryRouter>
      <CampaignsTab />
    </MemoryRouter>,
  );
const posted = (suffix: string) => sent.find((c) => c.path.endsWith(suffix) && c.init?.method === "POST");

beforeEach(() => {
  campaigns = [{
    id: "c1", name: "Renewals", status: "running", targets: COUNTS,
    created_at: "2026-10-09T10:00:00Z", timezone: "America/New_York",
  }];
  targets = [
    { id: "t1", position: 0, number: "+15552223333", status: "completed", attempts: 1, call_id: "call-1", ended_reason: "customer_ended_call", error: null },
    { id: "t2", position: 1, number: "+15554445555", status: "failed", attempts: 0, call_id: null, ended_reason: null, error: "dial_failed" },
  ];
});
afterEach(() => {
  sent.length = 0;
  cleanup();
});

it("lists campaigns with their progress", async () => {
  show();
  expect(await screen.findByText("Renewals")).toBeTruthy();
  expect(screen.getByText("1 pending · 1 calling · 2 done · 1 failed")).toBeTruthy();
});

it("the campaigns list carries the agent's do-not-call list", async () => {
  show();
  const section = await screen.findByRole("group", { name: "Do-not-call list" });
  expect(await within(section).findByText("+15553334444")).toBeTruthy();
  expect(within(section).getByText(/campaigns never call/i)).toBeTruthy();
  expect(within(section).getByLabelText(/add a number/i)).toBeTruthy(); // an editor can change it
});

it("opens a campaign: its targets and outcomes, and pause / cancel", async () => {
  show();
  fireEvent.click(await screen.findByText("Renewals"));
  const row = (await screen.findByText("+15554445555")).closest("tr")!;
  expect(within(row).getByText("failed")).toBeTruthy();
  expect(within(row).getByText("dial_failed")).toBeTruthy();
  expect(screen.getByText("customer_ended_call")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
  await waitFor(() => expect(posted("/campaigns/c1/pause")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /^cancel campaign$/i }));
  // Cancel is final, so it asks first.
  fireEvent.click(await screen.findByRole("button", { name: /yes, cancel it/i }));
  await waitFor(() => expect(posted("/campaigns/c1/cancel")).toBeTruthy());
});

it("creates a campaign from pasted targets, a window and a retry rule", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: /new campaign/i }));
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Spring" } });
  fireEvent.change(screen.getByLabelText("Default timezone"), { target: { value: "America/New_York" } });
  fireEvent.change(screen.getByLabelText(/targets/i), { target: { value: "number,name\n+15552223333,Jane" } });
  fireEvent.click(screen.getByLabelText(/only call between/i));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "10:00" } });
  fireEvent.change(screen.getByLabelText("Until"), { target: { value: "18:00" } });
  fireEvent.click(screen.getByLabelText("sun"));
  fireEvent.click(screen.getByLabelText(/retry no answer/i));
  fireEvent.click(screen.getByRole("button", { name: /start campaign/i }));

  await waitFor(() => expect(posted("/agents/a1/campaigns")).toBeTruthy());
  // The new campaign opens, to be watched.
  expect(await screen.findByRole("button", { name: /← campaigns/i })).toBeTruthy();
  expect(JSON.parse(String(posted("/agents/a1/campaigns")!.init!.body))).toEqual({
    name: "Spring",
    from_number_id: "pn1",
    timezone: "America/New_York",
    calling_window: { start: "10:00", end: "18:00", days: ["mon", "tue", "wed", "thu", "fri", "sat"] },
    retry_policy: { customer_did_not_answer: { max_attempts: 3, spacing_seconds: 3600 } },
    targets: [{ number: "+15552223333", variables: { name: "Jane" } }],
  });
});

it("names the rows TurnCall would refuse and sends nothing", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: /new campaign/i }));
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Spring" } });
  fireEvent.change(screen.getByLabelText(/targets/i), { target: { value: "+15552223333\n555-0000" } });
  expect(await screen.findByText(/row 2: 555-0000 is not an E\.164 number/i)).toBeTruthy();
  expect((screen.getByRole("button", { name: /start campaign/i }) as HTMLButtonElement).disabled).toBe(true);
});

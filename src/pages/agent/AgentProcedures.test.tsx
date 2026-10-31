// @vitest-environment jsdom
//
// The Procedures section of an agent's Build page (#130), through the page's
// own Save: write a procedure's steps and moves, pick its start step and a
// step's tool, escalate by transfer, and see TurnCall's refusal of one
// procedure on that procedure, and of one step on that step.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const puts: Record<string, unknown>[] = [];
let stored: Record<string, unknown> = {};
let refusal: Record<string, unknown> | null = null;
let catalog: unknown[] | null = null;

vi.mock("../../api", async (orig) => {
  const actual = await orig<typeof import("../../api")>();
  return {
    ...actual,
    api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
      if (path === "/agents/a1" && init?.method === "PUT") {
        if (refusal) {
          const r = refusal;
          refusal = null;
          throw new actual.ApiError(String(r.detail), 422, { reason: "invalid_agent_config", errors: r.errors as any, body: r });
        }
        const config = JSON.parse(init.body!).config;
        puts.push(config);
        stored = config;
        return { data: {} };
      }
      if (path === "/agents/a1")
        return { data: { agent_id: "a1", config: { name: "Ann", pipeline_mode: "cascade", ...stored }, backend: null, tool_statuses: null, tool_signing_secret: null } };
      if (path === "/integrations/catalog" && catalog) return { data: catalog };
      throw new Error("unavailable");
    }),
  };
});
let role = "editor";
vi.mock("../../auth", () => ({ useAuth: () => ({ activeWorkspace: { role } }) }));

import AgentPage from "./AgentPage";
import ConfigTab from "./ConfigTab";
import type { Procedure } from "../../types";
import { OTHER_TOOL } from "./procedures/stepTools";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/agents/a1"]}>
      <Routes>
        <Route path="agents/:id" element={<AgentPage />}>
          <Route index element={<ConfigTab section="procedures" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const rename = (el: HTMLElement, value: string) => {
  type(el, value);
  fireEvent.blur(el);
};

beforeEach(() => {
  puts.length = 0;
  stored = {};
  refusal = null;
  catalog = null;
  role = "editor";
});
afterEach(cleanup);

it("writes a procedure with two steps and a move, and saves it", async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Add procedure" }));
  const card = screen.getByRole("group", { name: "Procedure 1" });
  type(within(card).getByLabelText("Name"), "triage");
  type(within(card).getByLabelText("When it applies"), "A caller reports an outage.");
  fireEvent.click(within(card).getByRole("button", { name: "Add step" })); // a new one has its first

  const first = within(card).getByRole("listitem", { name: "Step step_1" });
  rename(within(first).getByLabelText("Step id"), "greet");
  type(within(first).getByLabelText("What to do"), "Ask what is wrong.");
  const second = within(card).getByRole("listitem", { name: "Step step_2" });
  type(within(second).getByLabelText("Kind"), "end");
  type(within(second).getByLabelText("What to do"), "Say goodbye.");

  const greet = within(card).getByRole("listitem", { name: "Step greet" });
  fireEvent.click(within(greet).getByRole("button", { name: "Add move" }));
  type(within(greet).getByLabelText("Condition of move 1"), "they describe it");
  save();

  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0].procedures).toEqual([
    {
      name: "triage",
      description: "A caller reports an outage.",
      steps: [
        { id: "greet", kind: "ask", text: "Ask what is wrong.", start: true, moves: [{ to: "step_2", when: "they describe it" }] },
        { id: "step_2", kind: "end", text: "Say goodbye." },
      ],
    },
  ]);
});

const TRIAGE = {
  name: "triage",
  steps: [
    { id: "greet", kind: "ask", text: "Ask what is wrong.", start: true, moves: [{ to: "check", when: "they describe it" }] },
    { id: "check", kind: "check", text: "Check the line.", moves: [{ to: "done", when: "it is fine" }] },
    { id: "done", kind: "end", text: "Say goodbye." },
  ],
};

it("moves and the start step pick from the procedure's own steps, and a renamed step keeps its moves", async () => {
  stored = { procedures: [TRIAGE] };
  renderPage();
  const card = await screen.findByRole("group", { name: "Procedure 1" });
  const greet = within(card).getByRole("listitem", { name: "Step greet" });
  expect(within(within(greet).getByLabelText("Target of move 1")).getAllByRole("option").map((o) => o.textContent))
    .toEqual(["→ check", "→ done"]);
  expect(within(within(card).getByLabelText("Start step")).getAllByRole("option").map((o) => o.textContent))
    .toEqual(["greet", "check", "done"]);

  rename(within(within(card).getByRole("listitem", { name: "Step check" })).getByLabelText("Step id"), "line_check");
  expect((within(greet).getByLabelText("Target of move 1") as HTMLSelectElement).value).toBe("line_check");
  type(within(card).getByLabelText("Start step"), "line_check");
  save();

  await waitFor(() => expect(puts).toHaveLength(1));
  const steps = (puts[0].procedures as Procedure[])[0].steps;
  expect(steps.map((s) => [s.id, s.start ?? false])).toEqual([["greet", false], ["line_check", true], ["done", false]]);
  expect(steps[0].moves).toEqual([{ to: "line_check", when: "they describe it" }]);
});

it("refuses a rename onto another step's id, and keeps the moves where they were", async () => {
  stored = { procedures: [TRIAGE] };
  renderPage();
  const card = await screen.findByRole("group", { name: "Procedure 1" });
  const check = within(card).getByRole("listitem", { name: "Step check" });
  rename(within(check).getByLabelText("Step id"), "done");
  expect(within(check).getByText('Another step is "done".')).toBeTruthy();
  expect((within(check).getByLabelText("Step id") as HTMLInputElement).value).toBe("check");
});

it("a step's tool is picked from the agent's tools", async () => {
  stored = { tools: ["end_call"], custom_tools: [{ name: "line_status" }], procedures: [TRIAGE] };
  renderPage();
  const check = within(await screen.findByRole("group", { name: "Procedure 1" })).getByRole("listitem", { name: "Step check" });
  const tool = within(check).getByLabelText("Tool");
  expect(within(tool).getAllByRole("option").map((o) => o.textContent)).toEqual(["No tool", "line_status", "end_call"]);
  type(tool, "line_status");
  save();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((puts[0].procedures as Procedure[])[0].steps[1]).toMatchObject({ id: "check", tool: "line_status" });
});

it("a step's tool can be one of a Connected app's tools the agent uses during calls", async () => {
  catalog = [
    { app: "google_calendar", name: "Google Calendar", tools: ["google_calendar-create-event"] },
    { app: "slack_v2", name: "Slack", tools: ["slack_v2-send-message"] },
  ];
  stored = {
    custom_tools: [{ name: "line_status" }],
    // Slack only posts when a call ends, so its tools are never in front of the model.
    integrations: [{ app: "google_calendar", mid_call: true }, { app: "slack_v2", call_ended: { action: "post", args: {} } }],
    procedures: [TRIAGE],
  };
  renderPage();
  const check = within(await screen.findByRole("group", { name: "Procedure 1" })).getByRole("listitem", { name: "Step check" });
  const tool = within(check).getByLabelText("Tool");
  await waitFor(() =>
    expect(within(tool).getByRole("group", { name: "Google Calendar" })).toBeTruthy(),
  );
  expect(within(tool).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "No tool", "line_status", "google_calendar-create-event",
  ]);
  type(tool, "google_calendar-create-event");
  save();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((puts[0].procedures as Procedure[])[0].steps[1]).toMatchObject({ tool: "google_calendar-create-event" });
});

it("an agent with MCP servers can name a tool they serve, which is only known on a call", async () => {
  stored = {
    mcp_servers: [{ name: "crm", transport: "http", url: "https://mcp.example.com/mcp" }],
    procedures: [TRIAGE],
  };
  renderPage();
  const check = within(await screen.findByRole("group", { name: "Procedure 1" })).getByRole("listitem", { name: "Step check" });
  type(within(check).getByLabelText("Tool"), OTHER_TOOL);
  type(within(check).getByLabelText("MCP tool name"), "crm_lookup");
  save();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((puts[0].procedures as Procedure[])[0].steps[1]).toMatchObject({ tool: "crm_lookup" });
});

it("a stored MCP tool name is shown as typed, not as a tool the agent lacks", async () => {
  stored = {
    workspace_mcp_servers: ["s1"],
    procedures: [{ ...TRIAGE, steps: TRIAGE.steps.map((s) => (s.id === "check" ? { ...s, tool: "crm_lookup" } : s)) }],
  };
  renderPage();
  const check = within(await screen.findByRole("group", { name: "Procedure 1" })).getByRole("listitem", { name: "Step check" });
  expect((within(check).getByLabelText("MCP tool name") as HTMLInputElement).value).toBe("crm_lookup");
  expect(within(check).queryByText(/not one of the agent's tools/)).toBeNull();
});

it("without MCP servers a tool cannot be typed", async () => {
  stored = { procedures: [TRIAGE] };
  renderPage();
  const check = within(await screen.findByRole("group", { name: "Procedure 1" })).getByRole("listitem", { name: "Step check" });
  const tool = within(check).getByLabelText("Tool");
  expect(within(tool).queryByRole("option", { name: OTHER_TOOL })).toBeNull();
});

it("an escalate step is a transfer, briefed from the call's summary", async () => {
  stored = { procedures: [TRIAGE] };
  renderPage();
  const done = within(await screen.findByRole("group", { name: "Procedure 1" })).getByRole("listitem", { name: "Step done" });
  type(within(done).getByLabelText("Kind"), "escalate");
  type(within(done).getByLabelText("Transfer to"), "+15551234567");
  type(within(done).getByLabelText("Transfer"), "warm");
  fireEvent.click(within(done).getByLabelText(/summary of the call/));
  type(within(done).getByLabelText("If nobody answers"), "Nobody is free, we will call back.");
  save();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((puts[0].procedures as Procedure[])[0].steps[2]).toEqual({
    id: "done", kind: "escalate", text: "Say goodbye.",
    escalate: {
      transfer_call: {
        target_number: "+15551234567", transfer_mode: "warm", briefing: { from_summary: true },
        fallback_message: "Nobody is free, we will call back.",
      },
    },
  });
});

it("a written briefing is saved as its text, and leaving escalate drops the transfer", async () => {
  stored = { procedures: [TRIAGE] };
  renderPage();
  const done = within(await screen.findByRole("group", { name: "Procedure 1" })).getByRole("listitem", { name: "Step done" });
  type(within(done).getByLabelText("Kind"), "escalate");
  type(within(done).getByLabelText("Transfer"), "warm");
  type(within(done).getByLabelText("Briefing"), "Caller's line is down.");
  save();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((puts[0].procedures as Procedure[])[0].steps[2].escalate?.transfer_call).toMatchObject({ briefing: "Caller's line is down." });

  type(within(done).getByLabelText("Kind"), "end");
  save();
  await waitFor(() => expect(puts).toHaveLength(2));
  expect((puts[1].procedures as Procedure[])[0].steps[2]).not.toHaveProperty("escalate");
});

it("a handoff escalation already in the config is kept as written, and not offered", async () => {
  const handoff = { id: "away", kind: "escalate", text: "Hand off.", escalate: { handoff_to_agent: { agent_id: "ag-2" } } };
  stored = { procedures: [{ ...TRIAGE, steps: [...TRIAGE.steps.slice(0, 2), { ...TRIAGE.steps[2] }, handoff] }] };
  renderPage();
  const away = within(await screen.findByRole("group", { name: "Procedure 1" })).getByRole("listitem", { name: "Step away" });
  expect(away.textContent).toMatch(/ag-2/);
  expect(within(away).queryByLabelText("Transfer to")).toBeNull();
  type(within(away).getByLabelText("What to do"), "Hand off now.");
  save();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((puts[0].procedures as Procedure[])[0].steps[3]).toEqual({ ...handoff, text: "Hand off now." });
});

it("sets how it starts and how far ahead the model sees", async () => {
  stored = { procedures: [TRIAGE] };
  renderPage();
  const card = await screen.findByRole("group", { name: "Procedure 1" });
  type(within(card).getByLabelText("Starts"), "on_request");
  type(within(card).getByLabelText("Steps shown ahead"), "3");
  save();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0].procedures).toEqual([{ ...TRIAGE, start: "on_request", window_depth: 3 }]);
});

it("removing the last procedure drops the key", async () => {
  stored = { procedures: [TRIAGE] };
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Remove procedure triage" }));
  save();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).not.toHaveProperty("procedures");
});

it("shows TurnCall's refusal on the procedure, and on the step its message names", async () => {
  const other = { ...TRIAGE, name: "billing" };
  stored = { procedures: [TRIAGE, other] };
  refusal = {
    detail: "procedures[1] 'billing': step 'check' moves to 'nowhere', which is not a step",
    errors: [
      { field: "procedures[1].steps[1]", message: "procedures[1] 'billing': step 'check' moves to 'nowhere', which is not a step" },
      { field: "procedures[0]", message: "procedures[0] 'triage': has no end or escalate step" },
    ],
  };
  renderPage();
  type(within(await screen.findByRole("group", { name: "Procedure 2" })).getByLabelText("When it applies"), "Bills.");
  save();

  const billing = screen.getByRole("group", { name: "Procedure 2" });
  const check = within(billing).getByRole("listitem", { name: "Step check" });
  await waitFor(() => expect(within(check).getByText(/moves to 'nowhere'/)).toBeTruthy());
  expect(within(within(billing).getByRole("listitem", { name: "Step greet" })).queryByText(/nowhere/)).toBeNull();
  const triage = screen.getByRole("group", { name: "Procedure 1" });
  expect(within(triage).getByText(/has no end or escalate step/)).toBeTruthy();
  expect(within(triage).queryByText(/nowhere/)).toBeNull();
});

it("a speech-to-speech agent is told TurnCall runs it without procedures", async () => {
  stored = { pipeline_mode: "s2s", procedures: [TRIAGE] };
  renderPage();
  expect((await screen.findByText(/follows no procedures/)).textContent).toMatch(/without them/);
  cleanup();
  stored = { procedures: [TRIAGE] };
  renderPage();
  await screen.findByRole("group", { name: "Procedure 1" });
  expect(screen.queryByText(/follows no procedures/)).toBeNull();
});

it("a viewer reads the procedures and cannot change them", async () => {
  role = "viewer";
  stored = { procedures: [TRIAGE] };
  renderPage();
  const card = await screen.findByRole("group", { name: "Procedure 1" });
  // The card's fieldset disables everything in it.
  expect(within(card).getByLabelText("Name").matches(":disabled")).toBe(true);
  expect(within(card).getByLabelText("Steps shown ahead").matches(":disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: /add|remove/i })).toBeNull();
});

it("outlines the graph from its start, and names a step nothing reaches", async () => {
  stored = { procedures: [{ ...TRIAGE, steps: [...TRIAGE.steps, { id: "orphan", kind: "end", text: "x" }] }] };
  renderPage();
  const outline = await screen.findByRole("complementary", { name: "Outline of triage" });
  const reached = within(outline).getAllByRole("list")[0];
  expect(reached.textContent).toMatch(/greet.*check.*done/);
  expect(outline.textContent).toMatch(/Not reachable from the start:.*orphan/);
});

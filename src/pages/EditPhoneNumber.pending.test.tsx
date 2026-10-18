// @vitest-environment jsdom
//
// Binding a bought Telnyx number whose order hadn't finished (#104, option 1).
// Nothing can ask Telnyx about the order, so a bind is the check: the Edit page
// says the submit is an attempt, a refusal keeps the form for a one-click
// retry, and a bind that succeeds drops the pending mark.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const REFUSAL =
  "Telnyx hasn't finished the order for +13125550100 (order ord-1) yet, so it can't be bound: try again in a few minutes.";

let row: Record<string, unknown> = {};
let answers: (() => unknown)[] = [];
const puts: Record<string, unknown>[] = [];

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/agents") return { data: { agents: [{ agent_id: "a1", name: "Front desk" }, { agent_id: "a2", name: "Sales" }] } };
    if (path === "/phone-numbers/n1" && init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)));
      return answers.shift()!();
    }
    if (path === "/phone-numbers/n1") return { data: row };
    return { data: {} };
  }),
}));

import EditPhoneNumber from "./EditPhoneNumber";

const pendingRow = {
  id: "n1",
  e164: "+13125550100",
  carrier: "telnyx",
  sid: "",
  label: null,
  routing_type: "none",
  agent_id: null,
  server_url: null,
  sms_enabled: false,
  twilio_account_sid: null,
  twilio_credentials: "platform",
  purchase_status: "pending",
  telnyx_order_id: "ord-1",
};

beforeEach(() => {
  row = { ...pendingRow };
  answers = [];
  puts.length = 0;
});
afterEach(cleanup);

function show(path = "/phone-numbers/n1/edit") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/phone-numbers/:id/edit" element={<EditPhoneNumber />} />
        <Route path="/phone-numbers" element={<p>Phone numbers list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

// The Agent picker (the Agent routing radio has the same label).
const agent = () => screen.getByLabelText("Agent", { selector: "select" }) as HTMLSelectElement;

const refuse = () => {
  throw new Error(REFUSAL);
};

it("explains that a bind is the check, and labels the submit as an attempt", async () => {
  show();
  const callout = await screen.findByRole("status");
  expect(callout.textContent).toContain("Ordered, waiting on Telnyx");
  expect(callout.textContent).toContain("ord-1");
  expect(callout.textContent).toMatch(/trying a bind is the check/);
  expect(callout.textContent).toMatch(/within minutes, unless the order is waiting on regulatory documents/);
  expect(callout.textContent).toMatch(/can take days/);
  // Opened to bind: Agent routing, even without ?bind.
  await waitFor(() => expect(agent()).toBeDefined());
  expect(screen.getByRole("button", { name: "Try binding now" })).toBeDefined();
});

it("keeps every value after a refusal and shows the sentence by the button, so a retry is one click", async () => {
  answers = [refuse, refuse];
  show();
  await waitFor(() => expect(agent()).toBeDefined());
  fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Front line" } });
  fireEvent.change(agent(), { target: { value: "a2" } });
  fireEvent.click(screen.getByLabelText("Agent + caller info"));

  fireEvent.click(screen.getByRole("button", { name: "Try binding now" }));
  expect((await screen.findByRole("alert")).textContent).toBe(REFUSAL);
  const button = screen.getByRole("button", { name: "Try binding now" });
  expect(button.nextElementSibling?.textContent).toBe(REFUSAL);
  expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("Front line");
  expect(agent().value).toBe("a2");
  expect((screen.getByLabelText("Agent + caller info") as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("Ordered, waiting on Telnyx");

  fireEvent.click(button);
  await waitFor(() => expect(puts).toHaveLength(2));
  expect(puts[1]).toEqual(puts[0]);
  expect(puts[0]).toMatchObject({ carrier: "telnyx", sid: "", routing_type: "agent_call_init", agent_id: "a2", label: "Front line" });
});

it("drops the pending mark once a bind succeeds", async () => {
  // Telnyx's webhook warning keeps the page up, so the bound state shows here.
  answers = [refuse, () => ({ data: { ...pendingRow, id: "tc-1", routing_type: "agent", agent_id: "a1", purchase_status: null, telnyx_order_id: null, webhooks_configured: false } })];
  show();
  await waitFor(() => expect(agent()).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Try binding now" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Try binding now" }));

  expect(await screen.findByText(/Telnyx was NOT configured/)).toBeDefined();
  expect(screen.queryByText("Ordered, waiting on Telnyx")).toBeNull();
});

it("goes to the list after a bind that succeeds cleanly", async () => {
  answers = [() => ({ data: { ...pendingRow, id: "tc-1", routing_type: "agent", agent_id: "a1", purchase_status: null, telnyx_order_id: null } })];
  show();
  await waitFor(() => expect(agent()).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Try binding now" }));
  expect(await screen.findByText("Phone numbers list")).toBeDefined();
});

it("calls an unassigned edit of a pending number a save", async () => {
  show();
  await waitFor(() => expect(agent()).toBeDefined());
  fireEvent.click(screen.getByLabelText("Unassigned"));
  expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Try binding now" })).toBeNull();
});

it("leaves a number that isn't pending as it was", async () => {
  row = { ...pendingRow, purchase_status: null, telnyx_order_id: null };
  show();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDefined());
  expect(screen.queryByRole("status")).toBeNull();
  expect((screen.getByLabelText("Unassigned") as HTMLInputElement).checked).toBe(true);
  cleanup();

  show("/phone-numbers/n1/edit?bind");
  await waitFor(() => expect(screen.getByRole("button", { name: "Bind number" })).toBeDefined());
  expect(screen.queryByRole("button", { name: "Try binding now" })).toBeNull();
});

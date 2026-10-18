// @vitest-environment jsdom
//
// Binding a bought Telnyx number whose order hadn't finished (#104, option 1).
// Nothing can ask Telnyx about the order, so a bind is the check: the Edit page
// says the submit is an attempt, a refusal keeps the form for a one-click
// retry, and a bind that succeeds drops the pending mark. Like any unassigned
// number, it opens on Unassigned unless the URL has ?bind, and a bind form
// makes the admin pick the agent (#106). The callout's "Bind it" switches the
// form to Agent routing in place, keeping what's typed (#108).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const tryBind = () => screen.getByRole("button", { name: "Try binding now" }) as HTMLButtonElement;
const BIND = "/phone-numbers/n1/edit?bind";

// Opened to bind: wait for the agents, then pick one.
async function pick(agentId = "a1") {
  await waitFor(() => expect(agent().options.length).toBeGreaterThan(1));
  fireEvent.change(agent(), { target: { value: agentId } });
}

const refuse = () => {
  throw new Error(REFUSAL);
};

it("explains that a bind is the check, and labels the submit as an attempt", async () => {
  show(BIND);
  const callout = await screen.findByRole("status");
  expect(callout.textContent).toContain("Ordered, waiting on Telnyx");
  expect(callout.textContent).toContain("ord-1");
  expect(callout.textContent).toMatch(/trying a bind is the check/);
  expect(callout.textContent).toMatch(/within minutes, unless the order is waiting on regulatory documents/);
  expect(callout.textContent).toMatch(/can take days/);
  // Opened to bind: Agent routing, and no "Bind it", since it's already here.
  await waitFor(() => expect(agent()).toBeDefined());
  expect(tryBind()).toBeDefined();
  expect(screen.queryByRole("button", { name: "Bind it" })).toBeNull();
});

it("without ?bind, opens on Unassigned with Save, and offers Bind it in place", async () => {
  show();
  const callout = await screen.findByRole("status");
  expect((screen.getByLabelText("Unassigned") as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Try binding now" })).toBeNull();
  expect(screen.queryByLabelText("Agent", { selector: "select" })).toBeNull();

  const bindIt = screen.getByRole("button", { name: "Bind it" });
  expect(callout.contains(bindIt)).toBe(true);
  expect(screen.queryByRole("link", { name: "Bind it" })).toBeNull();
  // Let the agents load, so the picker is there to take focus.
  await act(() => new Promise((r) => setTimeout(r, 0)));
  fireEvent.click(bindIt);
  // The same form, now a bind form: Agent routing, with the agent still to pick.
  await waitFor(() => expect(agent().options.length).toBe(3));
  expect(agent().value).toBe("");
  expect(agent().selectedOptions[0].textContent).toBe("Choose an agent…");
  expect(document.activeElement).toBe(agent());
  expect((screen.getByLabelText("Agent", { selector: "input" }) as HTMLInputElement).checked).toBe(true);
  expect(tryBind().disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Bind it" })).toBeNull();
});

it("Bind it keeps what's already typed", async () => {
  answers = [refuse];
  show();
  const label = (await screen.findByLabelText("Label")) as HTMLInputElement;
  fireEvent.change(label, { target: { value: "Front line" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Bind it" })).toBeDefined());

  fireEvent.click(screen.getByRole("button", { name: "Bind it" }));
  // Not remounted: the same input, still holding the edit.
  expect(screen.getByLabelText("Label")).toBe(label);
  expect(label.value).toBe("Front line");
  expect((screen.getByLabelText("Agent", { selector: "input" }) as HTMLInputElement).checked).toBe(true);
  await waitFor(() => expect(agent().options.length).toBe(3));
  expect(agent().value).toBe("");
  expect(tryBind().disabled).toBe(true);

  await pick("a2");
  fireEvent.click(tryBind());
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toMatchObject({ routing_type: "agent", agent_id: "a2", label: "Front line" });
});

it("Bind it gives a workspace's only agent, like picking Agent does", async () => {
  const { api } = await import("../api");
  const real = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) =>
    path === "/agents" ? { data: { agents: [{ agent_id: "a1", name: "Front desk" }] } } : real(path, init),
  );
  try {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Bind it" }));
    await waitFor(() => expect(agent().value).toBe("a1"));
    expect(tryBind().disabled).toBe(false);
  } finally {
    vi.mocked(api).mockImplementation(real);
  }
});

it("without ?bind, saves a label edit without binding", async () => {
  answers = [() => ({ data: { ...pendingRow, label: "Front line" } })];
  show();
  fireEvent.change(await screen.findByLabelText("Label"), { target: { value: "Front line" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toMatchObject({ routing_type: "none", label: "Front line" });
  expect(puts[0]).not.toHaveProperty("agent_id");
});

it("with ?bind, starts on a placeholder and won't submit until an agent is picked", async () => {
  show(BIND);
  await waitFor(() => expect(agent().options.length).toBe(3));
  expect(agent().value).toBe("");
  expect(agent().selectedOptions[0].textContent).toBe("Choose an agent…");
  expect(tryBind().disabled).toBe(true);
  expect(screen.getByText("Choose an agent to bind the number to.")).toBeDefined();
  fireEvent.click(tryBind());
  expect(puts).toHaveLength(0);

  fireEvent.change(agent(), { target: { value: "a2" } });
  expect(tryBind().disabled).toBe(false);
  expect(screen.queryByText("Choose an agent to bind the number to.")).toBeNull();
  expect(Array.from(agent().options).map((o) => o.value)).toEqual(["a1", "a2"]);
});

it("without ?bind, choosing Agent routing still asks for the agent", async () => {
  show();
  fireEvent.click(await screen.findByLabelText("Agent", { selector: "input" }));
  await waitFor(() => expect(agent().options.length).toBe(3));
  expect(agent().value).toBe("");
  expect(tryBind().disabled).toBe(true);
});

it("keeps every value after a refusal and shows the sentence by the button, so a retry is one click", async () => {
  answers = [refuse, refuse];
  show(BIND);
  await pick("a2");
  fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Front line" } });
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
  show(BIND);
  await pick();
  fireEvent.click(screen.getByRole("button", { name: "Try binding now" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Try binding now" }));

  expect(await screen.findByText(/Telnyx was NOT configured/)).toBeDefined();
  expect(screen.queryByText("Ordered, waiting on Telnyx")).toBeNull();
});

it("goes to the list after a bind that succeeds cleanly", async () => {
  answers = [() => ({ data: { ...pendingRow, id: "tc-1", routing_type: "agent", agent_id: "a1", purchase_status: null, telnyx_order_id: null } })];
  show(BIND);
  await pick();
  fireEvent.click(screen.getByRole("button", { name: "Try binding now" }));
  expect(await screen.findByText("Phone numbers list")).toBeDefined();
});

it("calls an unassigned edit of a pending number a save", async () => {
  show(BIND);
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

it("keeps a bound number's agent, with and without ?bind", async () => {
  row = { ...pendingRow, purchase_status: null, telnyx_order_id: null, routing_type: "agent", agent_id: "a2" };
  for (const path of ["/phone-numbers/n1/edit", BIND]) {
    show(path);
    await waitFor(() => expect(agent().options.length).toBe(2));
    expect(agent().value).toBe("a2");
    expect(screen.queryByText("Choose an agent…")).toBeNull();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
  }
});

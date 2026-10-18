// @vitest-environment jsdom
//
// Buy a number from Add Number (#100): admin-only, on the workspace's own
// connected carriers, then bound in the same flow — unless Telnyx is still
// completing the order.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Role } from "../types";

const AC = "AC" + "d".repeat(32);

const twilioNum = {
  carrier: "twilio", e164_number: "+13125550100", friendly_name: "(312) 555-0100",
  country: "US", region: "IL", locality: "Chicago", postal_code: "60601", number_type: "local",
  capabilities: { voice: true, sms: true, mms: false },
  upfront_cost: null, monthly_cost: null, currency: null,
};
const telnyxNum = {
  carrier: "telnyx", e164_number: "+13125550199", friendly_name: null,
  country: "US", region: "IL", locality: "Chicago", postal_code: null, number_type: "local",
  capabilities: { voice: true, sms: false, mms: false },
  upfront_cost: "1.00", monthly_cost: "1.50", currency: "USD",
};
// A registry row, as GET /phone-numbers and /phone-numbers/{id} return it:
// `purchase_status` is "pending" while a bought Telnyx order is unfinished.
const row = (over: Record<string, unknown> = {}) => ({
  id: "local-1", e164: "+13125550100", sid: "PN123", routing_type: "none", agent_id: null,
  project_id: null, server_url: null, server_url_secret: null, sms_enabled: false, label: null,
  carrier: "twilio", workspace_id: "w1", twilio_account_sid: AC, twilio_credentials: "workspace",
  purchase_status: null, ...over,
});
// POST /phone-numbers/purchase: the new registry row plus `status` and
// `telnyx_order_id`, which only this response carries.
const bought = (over: Record<string, unknown> = {}) => {
  const pending = over.status === "pending";
  return row({ status: "active", telnyx_order_id: null, purchase_status: pending ? "pending" : null, ...over });
};

const calls: { path: string; method?: string; body?: unknown }[] = [];
let role: Role = "admin";
let carriers = ["twilio", "telnyx"];
let purchased: Record<string, unknown> = bought();
// When set, searches wait on it, so a test can change the carrier mid-search.
let holdSearch: Promise<void> | null = null;
let refusePurchase = "";
let listed: unknown[] = [];

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/agents") return { data: { agents: [{ agent_id: "a1", name: "Support" }] } };
    if (path === "/integrations/twilio") return { data: { connected: true, account_sid: AC, numbers: [] } };
    if (path === "/integrations/twilio/numbers") return { data: [] };
    if (path === "/phone-numbers" && method === "GET") return { data: { phone_numbers: listed } };
    if (path === "/phone-numbers/local-1" && method === "GET") return { data: listed[0] };
    if (path.startsWith("/phone-numbers/available")) {
      const q = new URLSearchParams(path.split("?")[1] || "");
      const c = q.get("carrier");
      if (c && holdSearch) await holdSearch;
      return { data: { carriers, numbers: c === "twilio" ? [twilioNum] : c === "telnyx" ? [telnyxNum] : [] } };
    }
    if (path === "/phone-numbers/purchase") {
      if (refusePurchase) throw new Error(refusePurchase);
      return { data: purchased };
    }
    if (method === "PUT") return { data: { ...purchased, id: "tc-phone-1", rebound: true } };
    return { data: {} };
  }),
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ loading: false, activeWorkspace: { role } }),
}));

import AddPhoneNumber from "./AddPhoneNumber";
import PhoneNumbersList from "./PhoneNumbersList";
import EditPhoneNumber from "./EditPhoneNumber";

afterEach(() => {
  calls.length = 0;
  role = "admin";
  carriers = ["twilio", "telnyx"];
  purchased = bought();
  holdSearch = null;
  refusePurchase = "";
  listed = [];
  cleanup();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <AddPhoneNumber />
    </MemoryRouter>,
  );

async function openBuy() {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Buy a number" }));
  return (await screen.findByLabelText("Carrier")) as HTMLSelectElement;
}

it.each<Role>(["editor", "viewer"])("a%s sees Add Number as it is today, with no buy path", async (r) => {
  role = r;
  renderPage();
  expect(await screen.findByLabelText("Carrier")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Buy a number" })).toBeNull();
  expect(screen.getByRole("button", { name: "Bind number" })).toBeDefined();
  expect(calls.some((c) => c.path.startsWith("/phone-numbers/available"))).toBe(false);
});

it("an admin starts on binding, as today, and can switch to buying", async () => {
  renderPage();
  expect(screen.getByRole("button", { name: "Bind a number you have" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Bind number" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Buy a number" }));
  expect(await screen.findByRole("button", { name: "Search numbers" })).toBeDefined();
  // The carriers come from the server, asked without a carrier: nothing is searched.
  expect(calls.find((c) => c.path.startsWith("/phone-numbers/available"))?.path).toBe("/phone-numbers/available");
});

it("offers only the carriers the workspace has connected", async () => {
  carriers = ["telnyx"];
  const picker = await openBuy();
  const options = Array.from(picker.querySelectorAll("option")).map((o) => o.value);
  expect(options).toEqual(["telnyx"]);
});

it("with no carrier connected, points to the Integrations page", async () => {
  carriers = [];
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Buy a number" }));
  const link = await screen.findByRole("link", { name: "Integrations" });
  expect(link.getAttribute("href")).toBe("/integrations");
  expect(screen.queryByRole("button", { name: "Search numbers" })).toBeNull();
});

it("searches, buys and binds a Twilio number in one flow", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  await openBuy();
  fireEvent.change(screen.getByLabelText("Area code"), { target: { value: "312" } });
  fireEvent.change(screen.getByLabelText("Contains digits"), { target: { value: "5555" } });
  fireEvent.click(screen.getByRole("button", { name: "Search numbers" }));

  fireEvent.click(await screen.findByRole("button", { name: "Choose +13125550100" }));
  expect(calls.find((c) => c.path.includes("carrier="))?.path).toBe(
    "/phone-numbers/available?carrier=twilio&country=US&area_code=312&contains=5555",
  );
  // Twilio gives no prices, so there is no cost column.
  expect(screen.queryByRole("columnheader", { name: "Cost" })).toBeNull();
  // Picking is not buying: the purchase waits for the confirmation.
  expect(calls.some((c) => c.path === "/phone-numbers/purchase")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Buy +13125550100" }));

  expect(await screen.findByText(/Bought \+13125550100 on Twilio/)).toBeDefined();
  expect(calls.find((c) => c.path === "/phone-numbers/purchase")).toMatchObject({
    method: "POST",
    body: { carrier: "twilio", e164: "+13125550100" },
  });

  await waitFor(() => expect(screen.getByText("Support")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Bind number" }));
  await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  expect(calls.find((c) => c.method === "PUT")).toMatchObject({
    path: "/phone-numbers/local-1",
    body: { carrier: "twilio", e164: "+13125550100", sid: "PN123", routing_type: "agent", agent_id: "a1" },
  });
  // Binding a new number is not a move between projects: no browser confirm().
  expect(confirmSpy).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

it("shows Telnyx's price and binds a Telnyx number once bought", async () => {
  purchased = bought({ e164: "+13125550199", sid: "tel-1", carrier: "telnyx", twilio_account_sid: null, twilio_credentials: "platform" });
  const picker = await openBuy();
  fireEvent.change(picker, { target: { value: "telnyx" } });
  fireEvent.click(screen.getByRole("button", { name: "Search numbers" }));

  expect(await screen.findByText("1.00 USD upfront + 1.50 USD/month")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Choose +13125550199" }));
  expect(screen.getByRole("group", { name: "Buy +13125550199" }).textContent).toContain(
    "It costs 1.00 USD upfront + 1.50 USD/month",
  );
  fireEvent.click(screen.getByRole("button", { name: "Buy +13125550199" }));

  expect(await screen.findByText(/Bought \+13125550199 on Telnyx/)).toBeDefined();
  await waitFor(() => expect(screen.getByText("Support")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Bind number" }));
  await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  // Telnyx binds by E.164: no SID is sent.
  expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ carrier: "telnyx", sid: "", routing_type: "agent" });
});

it("says a pending Telnyx order can be bound once Telnyx finishes, and links to its Edit page", async () => {
  purchased = bought({
    e164: "+13125550199", sid: "", carrier: "telnyx", twilio_account_sid: null,
    twilio_credentials: "platform", status: "pending", telnyx_order_id: "ord-1",
  });
  const picker = await openBuy();
  fireEvent.change(picker, { target: { value: "telnyx" } });
  fireEvent.click(screen.getByRole("button", { name: "Search numbers" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose +13125550199" }));
  fireEvent.click(screen.getByRole("button", { name: "Buy +13125550199" }));

  const status = await screen.findByRole("status");
  expect(status.textContent).toContain("+13125550199 is ordered from Telnyx");
  // The same rule as the Edit page: bindable once the order lands, refused before.
  expect(status.textContent).toContain("can be bound once Telnyx finishes it; until then a bind is refused");
  expect(screen.queryByRole("button", { name: "Bind number" })).toBeNull();
  expect(screen.getByRole("link", { name: "Bind it on its Edit page" }).getAttribute("href")).toBe(
    "/phone-numbers/local-1/edit?bind",
  );
  expect(screen.getByRole("link", { name: "Go to Phone Numbers" }).getAttribute("href")).toBe("/phone-numbers");
});

it("shows builder-api's refusal as a sentence and drops the pick", async () => {
  refusePurchase = "TurnCall did not answer, so +13125550100 may have been bought: check the Twilio account before buying it again";
  await openBuy();
  fireEvent.click(screen.getByRole("button", { name: "Search numbers" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose +13125550100" }));
  fireEvent.click(screen.getByRole("button", { name: "Buy +13125550100" }));

  expect((await screen.findByRole("alert")).textContent).toBe(refusePurchase);
  expect(screen.queryByRole("button", { name: "Buy +13125550100" })).toBeNull();
});

it("a bought number left unbound is listed on Phone Numbers as unassigned", async () => {
  listed = [row()];
  render(
    <MemoryRouter>
      <PhoneNumbersList />
    </MemoryRouter>,
  );
  const cell = await screen.findByText("+13125550100");
  const tr = cell.closest("tr") as HTMLTableRowElement;
  expect(tr.textContent).toContain("unassigned");
});

it("a pending Telnyx order is listed as ordered, waiting on Telnyx", async () => {
  listed = [
    row({ e164: "+13125550199", sid: "", carrier: "telnyx", twilio_credentials: "platform", purchase_status: "pending" }),
    row({ id: "local-2", purchase_status: null }),
  ];
  render(
    <MemoryRouter>
      <PhoneNumbersList />
    </MemoryRouter>,
  );
  const pending = (await screen.findByText("+13125550199")).closest("tr") as HTMLTableRowElement;
  expect(pending.textContent).toContain("ordered, waiting on Telnyx");
  const active = screen.getByText("+13125550100").closest("tr") as HTMLTableRowElement;
  expect(active.textContent).not.toContain("ordered");
});

it("the edit page says a pending Telnyx order can be bound once it lands", async () => {
  listed = [row({ e164: "+13125550199", sid: "", carrier: "telnyx", twilio_credentials: "platform", purchase_status: "pending" })];
  render(
    <MemoryRouter initialEntries={["/phone-numbers/local-1/edit"]}>
      <Routes>
        <Route path="/phone-numbers/:id/edit" element={<EditPhoneNumber />} />
      </Routes>
    </MemoryRouter>,
  );
  expect((await screen.findByRole("status")).textContent).toContain("Ordered, waiting on Telnyx");
  // Binding stays offered, as an attempt: the pending mark clears with the first
  // bind that succeeds (#104; EditPhoneNumber.pending.test.tsx has the rest).
  expect(screen.getByRole("button", { name: "Try binding now" })).toBeDefined();
});

it("drops a search that comes back after the carrier changed, and the confirmation names the number's carrier", async () => {
  let finish!: () => void;
  holdSearch = new Promise((r) => (finish = r));
  const picker = await openBuy();
  fireEvent.click(screen.getByRole("button", { name: "Search numbers" })); // a Twilio search, still running
  fireEvent.change(picker, { target: { value: "telnyx" } });
  finish();
  await waitFor(() => expect(calls.filter((c) => c.path.includes("carrier=")).length).toBe(1));
  await new Promise((r) => setTimeout(r, 0));
  // The Twilio results don't land under Telnyx.
  expect(screen.queryByRole("button", { name: "Choose +13125550100" })).toBeNull();

  holdSearch = null;
  fireEvent.click(screen.getByRole("button", { name: "Search numbers" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose +13125550199" }));
  expect(screen.getByRole("group", { name: "Buy +13125550199" }).textContent).toContain("Buy +13125550199 on Telnyx?");
  fireEvent.click(screen.getByRole("button", { name: "Buy +13125550199" }));
  await waitFor(() =>
    expect(calls.find((c) => c.path === "/phone-numbers/purchase")?.body).toEqual({ carrier: "telnyx", e164: "+13125550199" }),
  );
});

it("locks the Bind/Buy switch while buying and hides it once a number is bought", async () => {
  let finish!: () => void;
  const held = new Promise<void>((r) => (finish = r));
  const { api } = await import("../api");
  const real = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/phone-numbers/purchase") await held;
    return real(path, init);
  });
  try {
    await openBuy();
    fireEvent.click(screen.getByRole("button", { name: "Search numbers" }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose +13125550100" }));
    fireEvent.click(screen.getByRole("button", { name: "Buy +13125550100" }));
    const toBind = screen.getByRole("button", { name: "Bind a number you have" }) as HTMLButtonElement;
    await waitFor(() => expect(toBind.disabled).toBe(true));
    finish();
    expect(await screen.findByText(/Bought \+13125550100 on Twilio/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Bind a number you have" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Buy a number" })).toBeNull();
  } finally {
    vi.mocked(api).mockImplementation(real);
  }
});

const renderEdit = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/phone-numbers/:id/edit" element={<EditPhoneNumber />} />
        <Route path="/phone-numbers" element={<p>list</p>} />
      </Routes>
    </MemoryRouter>,
  );
const routingChoice = (name: string) =>
  screen.getByRole("radio", { name }) as HTMLInputElement;

it("the edit page opened to bind an unassigned number starts on Agent routing", async () => {
  listed = [row()];
  renderEdit("/phone-numbers/local-1/edit?bind");
  fireEvent.click(await screen.findByRole("button", { name: "Bind number" }));
  await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ routing_type: "agent", agent_id: "a1" });
});

it("editing an unassigned number without ?bind keeps it unassigned", async () => {
  listed = [row()];
  renderEdit("/phone-numbers/local-1/edit");
  const save = await screen.findByRole("button", { name: "Save" });
  expect(routingChoice("Unassigned").checked).toBe(true);
  fireEvent.click(save);
  await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ routing_type: "none" });
});

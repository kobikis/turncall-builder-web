// @vitest-environment jsdom
//
// Unbind and "Remove from list" (#103): worded by what they do to the row, both
// saying the number stays on the carrier account, confirmed in-page (no
// browser confirm()), and clearly different from Release (#101).
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PhoneNumber, Role } from "../types";

const row = (over: Partial<PhoneNumber>): PhoneNumber => ({
  id: "n-free",
  e164: "+13125550100",
  carrier: "twilio",
  routing_type: "none",
  agent_id: null,
  server_url: null,
  sms_enabled: false,
  ...over,
});
const seed = (): PhoneNumber[] => [
  row({}),
  row({ id: "n-routed", e164: "+13125550102", carrier: "telnyx", routing_type: "agent", agent_id: "a1" }),
];

const calls: { path: string; method?: string }[] = [];
let numbers = seed();
let refuse = "";
let role: Role = "editor";

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method });
    if (path === "/agents") return { data: { agents: [{ agent_id: "a1", name: "Front desk" }] } };
    if (path === "/phone-numbers") return { data: { phone_numbers: numbers } };
    const m = path.match(/^\/phone-numbers\/([^/]+)$/);
    if (m && init?.method === "DELETE") {
      if (refuse) throw new Error(refuse);
      numbers = numbers.filter((n) => n.id !== m[1]);
      return { data: { deleted: m[1] } };
    }
    throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
  }),
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ loading: false, activeWorkspace: { role } }),
}));

import PhoneNumbersList from "./PhoneNumbersList";

const confirmSpy = vi.spyOn(window, "confirm");

afterEach(() => {
  calls.length = 0;
  numbers = seed();
  refuse = "";
  role = "editor";
  confirmSpy.mockClear();
  cleanup();
});

const renderList = async () => {
  render(
    <MemoryRouter>
      <PhoneNumbersList />
    </MemoryRouter>,
  );
  await screen.findByText("+13125550100");
};
const rowOf = (e164: string) => screen.getByText(e164).closest("tr") as HTMLElement;
const deletes = () => calls.filter((c) => c.method === "DELETE");

it("labels a routed number Unbind and an unassigned one Remove from list", async () => {
  await renderList();
  expect(within(rowOf("+13125550102")).getByRole("button", { name: "Unbind" })).toBeTruthy();
  expect(within(rowOf("+13125550100")).getByRole("button", { name: "Remove from list" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^remove$/i })).toBeNull();
});

it("a viewer gets no row actions", async () => {
  role = "viewer";
  await renderList();
  expect(screen.queryByRole("button", { name: /Unbind|Remove from list|Release/ })).toBeNull();
});

it("unbinding a routed number confirms in-page that it stays on the carrier account", async () => {
  await renderList();
  fireEvent.click(within(rowOf("+13125550102")).getByRole("button", { name: "Unbind" }));
  const dialog = screen.getByRole("alertdialog", { name: "Unbind +13125550102" });
  expect(dialog.textContent).toMatch(/Calls to this number stop reaching TurnCall/);
  expect(dialog.textContent).toMatch(/stays on your Telnyx account and is still billed/);
  expect(deletes()).toEqual([]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Unbind number" }));
  await waitFor(() => expect(screen.queryByText("+13125550102")).toBeNull());
  expect(deletes()).toEqual([{ path: "/phone-numbers/n-routed", method: "DELETE" }]);
  expect(screen.getByRole("status").textContent).toMatch(/Unbound \+13125550102\. The number stays on your Telnyx account/);
  expect(confirmSpy).not.toHaveBeenCalled();
});

it("removing an unassigned number says it is still billed and points an editor to an admin's Release", async () => {
  await renderList();
  fireEvent.click(within(rowOf("+13125550100")).getByRole("button", { name: "Remove from list" }));
  const dialog = screen.getByRole("alertdialog", { name: "Remove +13125550100 from the list" });
  expect(dialog.textContent).toMatch(/TurnCall forgets this number/);
  expect(dialog.textContent).toMatch(/stays on your Twilio account and is still billed/);
  expect(dialog.textContent).toMatch(/a workspace admin can release it/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove from list" }));
  await waitFor(() => expect(screen.queryByText("+13125550100")).toBeNull());
  expect(deletes()).toEqual([{ path: "/phone-numbers/n-free", method: "DELETE" }]);
  expect(confirmSpy).not.toHaveBeenCalled();
});

it("for an admin, remove and release on the same row read as different actions", async () => {
  role = "admin";
  await renderList();
  const r = rowOf("+13125550100");
  fireEvent.click(within(r).getByRole("button", { name: "Remove from list" }));
  const remove = screen.getByRole("alertdialog", { name: "Remove +13125550100 from the list" });
  expect(remove.textContent).toMatch(/still billed/);
  expect(remove.textContent).toMatch(/To stop paying for it, use Release instead/);
  expect(remove.textContent).toMatch(/You can add it again later/);
  expect(remove.textContent).not.toMatch(/can't be undone/);
  expect(within(remove).queryByRole("textbox")).toBeNull();

  fireEvent.click(within(r).getByRole("button", { name: "Release" }));
  expect(screen.queryByRole("alertdialog", { name: /Remove/ })).toBeNull(); // one confirmation at a time
  const release = screen.getByRole("alertdialog", { name: "Release +13125550100" });
  expect(release.textContent).toMatch(/can't be undone/);
  expect(release.textContent).toMatch(/billing for it stops/);
  expect(release.textContent).not.toMatch(/still billed/);
  expect(within(release).getByRole("textbox")).toBeTruthy();
});

it("cancel closes the confirmation without deleting", async () => {
  await renderList();
  fireEvent.click(within(rowOf("+13125550102")).getByRole("button", { name: "Unbind" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(deletes()).toEqual([]);
});

it("shows a refusal inside the confirmation and keeps the number", async () => {
  refuse = "TurnCall rejected the unbind: carrier unreachable";
  await renderList();
  fireEvent.click(within(rowOf("+13125550102")).getByRole("button", { name: "Unbind" }));
  fireEvent.click(screen.getByRole("button", { name: "Unbind number" }));
  const dialog = screen.getByRole("alertdialog", { name: "Unbind +13125550102" });
  expect((await within(dialog).findByRole("alert")).textContent).toBe(refuse);
  expect(screen.getByText("+13125550102")).toBeTruthy();
});

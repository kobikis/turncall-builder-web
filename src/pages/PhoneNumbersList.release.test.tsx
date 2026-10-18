// @vitest-environment jsdom
//
// Releasing a number (#101): admin-only, unassigned numbers only, confirmed
// in-page by typing the exact E.164. builder-api's refusals show as sentences.
// Clicking Release asks builder-api's release check first (builder-api #111):
// only a releasable number gets the confirmation.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PhoneNumber, ReleaseCheck, Role } from "../types";

const row = (over: Partial<PhoneNumber>): PhoneNumber => ({
  id: "n-free",
  e164: "+13125550100",
  carrier: "twilio",
  routing_type: "none",
  agent_id: null,
  server_url: null,
  sms_enabled: false,
  sid: "PN1",
  twilio_credentials: "workspace",
  purchase_status: null,
  ...over,
});
const seed = (): PhoneNumber[] => [
  row({}),
  row({ id: "n-telnyx", e164: "+13125550101", carrier: "telnyx", twilio_credentials: "platform" }),
  row({ id: "n-routed", e164: "+13125550102", routing_type: "agent", agent_id: "a1" }),
  row({ id: "n-pbx", e164: "+13125550103", carrier: "asterisk", sid: "", twilio_credentials: "platform" }),
];

const calls: { path: string; method?: string; body?: unknown }[] = [];
let numbers = seed();
let refuse = "";
let role: Role = "admin";
// When set, a release waits on it, so a test can act while it runs.
let hold: Promise<void> | null = null;
// The release check's answer per row id: releasable when absent, a thrown Error
// for a failed check (a 502). `checkHold` makes a check wait, like `hold`.
let checks: Record<string, Partial<ReleaseCheck> | Error> = {};
let checkHold: Promise<void> | null = null;

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/agents") return { data: { agents: [{ agent_id: "a1", name: "Front desk" }] } };
    if (path === "/phone-numbers") return { data: { phone_numbers: numbers } };
    const c = path.match(/^\/phone-numbers\/([^/]+)\/release-check$/);
    if (c && !init?.method) {
      if (checkHold) await checkHold;
      const answer = checks[c[1]];
      if (answer instanceof Error) throw answer;
      const n = numbers.find((x) => x.id === c[1])!;
      return { data: { releasable: true, detail: null, twilio_credentials: n.twilio_credentials, ...answer } };
    }
    const m = path.match(/^\/phone-numbers\/([^/]+)\/release$/);
    if (m && init?.method === "POST") {
      if (hold) await hold;
      if (refuse) throw new Error(refuse);
      const gone = numbers.find((n) => n.id === m[1])!;
      numbers = numbers.filter((n) => n.id !== m[1]);
      return { data: { released: gone.e164, carrier: gone.carrier, external_number_sid: "PN1" } };
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
  role = "admin";
  hold = null;
  checks = {};
  checkHold = null;
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
const clickRelease = (e164: string) =>
  fireEvent.click(within(rowOf(e164)).getByRole("button", { name: "Release" }));
// Clicks Release and waits for the check to open the confirmation.
const openRelease = async (e164: string) => {
  clickRelease(e164);
  return screen.findByRole("alertdialog", { name: `Release ${e164}` });
};
const checksOf = () => calls.filter((c) => c.path.endsWith("/release-check"));
const releases = () => calls.filter((c) => c.path.endsWith("/release"));

it("offers release to an admin on unassigned Twilio and Telnyx numbers only", async () => {
  numbers = [...seed(), row({ id: "n-platform", e164: "+13125550104", twilio_credentials: "platform" })];
  await renderList();
  expect(within(rowOf("+13125550100")).getByRole("button", { name: "Release" })).toBeTruthy();
  expect(within(rowOf("+13125550101")).getByRole("button", { name: "Release" })).toBeTruthy();
  // A Twilio number with no stored account gets Release too: the check finds out where it is.
  expect(within(rowOf("+13125550104")).getByRole("button", { name: "Release" })).toBeTruthy();
  // A routed number has no release action; nor does a PBX number, which no carrier sells.
  expect(within(rowOf("+13125550102")).queryByRole("button", { name: "Release" })).toBeNull();
  expect(within(rowOf("+13125550103")).queryByRole("button", { name: "Release" })).toBeNull();
  expect(checksOf()).toEqual([]); // nothing is checked until Release is clicked
});

it.each<Role>(["editor", "viewer"])("a %s sees no release action", async (r) => {
  role = r;
  await renderList();
  expect(screen.queryByRole("button", { name: "Release" })).toBeNull();
});

it("checks the number first, with the row busy, then confirms in-page", async () => {
  let finish!: () => void;
  checkHold = new Promise((r) => (finish = r));
  await renderList();
  clickRelease("+13125550100");
  const busy = within(rowOf("+13125550100")).getByRole("button", { name: "Checking…" }) as HTMLButtonElement;
  expect(busy.disabled).toBe(true);
  expect((within(rowOf("+13125550100")).getByRole("button", { name: "Remove from list" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(checksOf()).toEqual([{ path: "/phone-numbers/n-free/release-check", method: undefined, body: undefined }]);
  finish();
  await screen.findByRole("alertdialog", { name: "Release +13125550100" });
  expect(within(rowOf("+13125550100")).getByRole("button", { name: "Release" })).toBeTruthy();
  expect(releases()).toEqual([]);
});

it("confirms in-page that release is irreversible and the carrier may resell the number", async () => {
  await renderList();
  const dialog = await openRelease("+13125550100");
  expect(dialog.textContent).toMatch(/can't be undone/);
  expect(dialog.textContent).toMatch(/Twilio takes the number back and billing for it stops/);
  expect(dialog.textContent).toMatch(/may sell it to someone else/);
  expect(confirmSpy).not.toHaveBeenCalled();
});

it("can't be submitted until the exact number is typed", async () => {
  await renderList();
  await openRelease("+13125550100");
  const button = screen.getByRole("button", { name: "Release number permanently" }) as HTMLButtonElement;
  const input = screen.getByLabelText("Type +13125550100 to confirm");
  expect(button.disabled).toBe(true);
  fireEvent.change(input, { target: { value: "+1312555010" } });
  expect(button.disabled).toBe(true);
  fireEvent.change(input, { target: { value: "+13125550101" } }); // another number on the page
  expect(button.disabled).toBe(true);
  fireEvent.change(input, { target: { value: " +13125550100 " } });
  expect(button.disabled).toBe(false);
  expect(calls.some((c) => c.path.endsWith("/release"))).toBe(false);
});

it("sends the typed number as confirm, and the number leaves the list", async () => {
  await renderList();
  await openRelease("+13125550101");
  fireEvent.change(screen.getByLabelText("Type +13125550101 to confirm"), { target: { value: "+13125550101 " } });
  fireEvent.click(screen.getByRole("button", { name: "Release number permanently" }));
  await waitFor(() => expect(screen.queryByText("+13125550101")).toBeNull());
  expect(calls).toContainEqual({
    path: "/phone-numbers/n-telnyx/release",
    method: "POST",
    body: { confirm: "+13125550101" },
  });
  expect(screen.getByRole("status").textContent).toBe("Released +13125550101 back to Telnyx.");
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("cancel closes the confirmation without releasing", async () => {
  await renderList();
  await openRelease("+13125550100");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(calls.some((c) => c.path.endsWith("/release"))).toBe(false);
});

it.each([
  ["not releasable after all (409)", "+13125550100 isn't on this workspace's Twilio account. It may be on TurnCall's platform account; only the TurnCall operator can release it."],
  ["still bound (409)", "TurnCall refused to release +13125550100: Phone number +13125550100 is bound; unbind it before releasing it"],
  ["confirmation mismatch (422)", "Releasing is irreversible: confirm by typing the number being released (+13125550100)."],
  ["shared platform account (403)", "TurnCall refused to release +13125550100: this number is on the platform's shared account"],
  ["carrier error (502)", "TurnCall refused to release +13125550100: Twilio returned an error"],
])("shows the %s refusal as a sentence and keeps the number", async (_, sentence) => {
  refuse = sentence;
  await renderList();
  await openRelease("+13125550100");
  fireEvent.change(screen.getByLabelText("Type +13125550100 to confirm"), { target: { value: "+13125550100" } });
  fireEvent.click(screen.getByRole("button", { name: "Release number permanently" }));
  const dialog = screen.getByRole("alertdialog", { name: "Release +13125550100" });
  expect((await within(dialog).findByRole("alert")).textContent).toBe(sentence);
  expect(screen.getByText("+13125550100")).toBeTruthy();
});

const NOT_HERE =
  "+13125550104 isn't on this workspace's Twilio account. It may be on TurnCall's platform account; only the TurnCall operator can release it.";
const platformRow = () => row({ id: "n-platform", e164: "+13125550104", twilio_credentials: "platform" });

it("shows why a number can't be released, with no confirmation to fill in", async () => {
  numbers = [row({}), platformRow()];
  checks = { "n-platform": { releasable: false, detail: NOT_HERE } };
  await renderList();
  clickRelease("+13125550104");
  const box = await screen.findByRole("group", { name: "Release +13125550104" });
  expect(within(box).getByRole("status").textContent).toBe(NOT_HERE);
  expect(box.className).toContain("warn");
  expect(within(box).queryByRole("textbox")).toBeNull();
  expect(within(box).queryByRole("button", { name: "Release number permanently" })).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByText("+13125550104")).toBeTruthy(); // the number stays
  fireEvent.click(within(box).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("group", { name: "Release +13125550104" })).toBeNull();
  expect(releases()).toEqual([]);
});

it("a Twilio number the check finds on the workspace's account opens the confirmation, and the list is refreshed", async () => {
  numbers = [row({}), platformRow()];
  checks = { "n-platform": { releasable: true, twilio_credentials: "workspace" } };
  await renderList();
  const before = calls.filter((c) => c.path === "/phone-numbers").length;
  const dialog = await openRelease("+13125550104");
  expect(within(dialog).getByLabelText("Type +13125550104 to confirm")).toBeTruthy();
  await waitFor(() => expect(calls.filter((c) => c.path === "/phone-numbers").length).toBe(before + 1));
});

it("shows a check that failed as an error in the row, with no confirmation", async () => {
  const sentence = "Couldn't reach Twilio to check +13125550100; try again.";
  checks = { "n-free": new Error(sentence) };
  await renderList();
  clickRelease("+13125550100");
  const box = await screen.findByRole("group", { name: "Release +13125550100" });
  expect(within(box).getByRole("alert").textContent).toBe(sentence);
  expect(box.className).toContain("error");
  expect(within(box).queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  // Release can be tried again.
  expect((within(rowOf("+13125550100")).getByRole("button", { name: "Release" }) as HTMLButtonElement).disabled).toBe(false);
});

it("a check that answers after another row's confirmation opened leaves that confirmation alone", async () => {
  let finish!: () => void;
  checkHold = new Promise((r) => (finish = r));
  await renderList();
  clickRelease("+13125550100");
  fireEvent.click(within(rowOf("+13125550101")).getByRole("button", { name: "Remove from list" }));
  finish();
  await waitFor(() => expect(within(rowOf("+13125550100")).getByRole("button", { name: "Release" })).toBeTruthy());
  expect(screen.getByRole("alertdialog", { name: "Remove +13125550101 from the list" })).toBeTruthy();
  expect(screen.queryByRole("alertdialog", { name: "Release +13125550100" })).toBeNull();
});

it("a Telnyx number is still released, though its row reads twilio_credentials platform", async () => {
  await renderList();
  const dialog = await openRelease("+13125550101");
  expect(dialog.textContent).toMatch(/Release \+13125550101 back to Telnyx/);
});

it("removing a Twilio number with no stored account says so, and that Release checks where it is", async () => {
  numbers = [row({}), platformRow()];
  await renderList();
  fireEvent.click(within(rowOf("+13125550104")).getByRole("button", { name: "Remove from list" }));
  const dialog = screen.getByRole("alertdialog", { name: "Remove +13125550104 from the list" });
  expect(dialog.textContent).toMatch(/No Twilio account is stored with this number yet\./);
  expect(dialog.textContent).toMatch(/Removing it doesn't release it\. Release checks which Twilio account it's on\./);
  expect(dialog.textContent).not.toMatch(/platform/);
  expect(dialog.textContent).not.toMatch(/your Twilio account/);
  expect(dialog.textContent).not.toMatch(/use Release instead/);
});

it("offers no release on a pending Telnyx order and says when it can be released", async () => {
  numbers = [row({}), row({ id: "n-ordered", e164: "+13125550105", carrier: "telnyx", sid: "", twilio_credentials: "platform", purchase_status: "pending" })];
  await renderList();
  const r = rowOf("+13125550105");
  expect(within(r).queryByRole("button", { name: "Release" })).toBeNull();
  expect(r.textContent).toContain("Can be released once Telnyx finishes the order.");
  expect(rowOf("+13125550100").textContent).not.toContain("once Telnyx finishes");
});

async function startHeldRelease(e164: string) {
  let finish!: () => void;
  hold = new Promise((r) => (finish = r));
  await openRelease(e164);
  fireEvent.change(screen.getByLabelText(`Type ${e164} to confirm`), { target: { value: e164 } });
  fireEvent.click(screen.getByRole("button", { name: "Release number permanently" }));
  await waitFor(() => expect(calls.some((c) => c.path.endsWith("/release"))).toBe(true));
  return finish;
}

it("can't cancel a release while it runs", async () => {
  await renderList();
  const finish = await startHeldRelease("+13125550100");
  expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  finish();
  await waitFor(() => expect(screen.queryByText("+13125550100")).toBeNull());
});

it.each([
  ["succeeds", ""],
  ["is refused", "TurnCall refused to release +13125550100: Twilio returned an error"],
])("a release that %s after another row's confirmation opened leaves that confirmation alone", async (_, sentence) => {
  refuse = sentence;
  await renderList();
  const finish = await startHeldRelease("+13125550100");
  const other = await openRelease("+13125550101");
  expect((within(other).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
  finish();
  await waitFor(() => expect(calls.filter((c) => c.path === "/phone-numbers").length).toBeGreaterThan(sentence ? 0 : 1));
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.getByRole("alertdialog", { name: "Release +13125550101" })).toBeTruthy();
  expect(within(screen.getByRole("alertdialog")).queryByRole("alert")).toBeNull();
});

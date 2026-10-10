// @vitest-environment jsdom
//
// A workspace's own Telnyx and Asterisk accounts (#75, builder-api#84), shown
// under Telephony beside its Twilio account.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProviderCard } from "./ProviderAccounts";

const calls: { path: string; method?: string; body?: unknown }[] = [];
let cards: ProviderCard[] = [];

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body });
    if (path === "/integrations/providers") return { data: { providers: cards } };
    if (path === "/integrations/twilio") return { data: { connected: false, numbers: [] } };
    return { data: {} };
  }),
  ApiError: class ApiError extends Error {},
}));

import { ProviderAccounts, disconnectText } from "./ProviderAccounts";

const card = (provider: string): ProviderCard => ({
  provider,
  serves: { carrier: [provider] },
  connected: false,
  last4: null,
  validation: null,
  disconnecting: false,
  platform_key: false,
  runs_on: "none",
  agents_using: 0,
  pinned_agents: [],
  agents: [],
});

afterEach(() => {
  calls.length = 0;
  cleanup();
});

const put = () => calls.find((c) => c.method === "PUT")!;

it("puts Twilio, Telnyx and Asterisk together under Telephony", async () => {
  cards = [{ ...card("openai"), serves: { llm: ["openai"] } }, card("telnyx"), card("asterisk")];
  render(<ProviderAccounts isAdmin />);
  await screen.findByTestId("provider-telnyx");
  const telephony = screen.getByRole("region", { name: "Telephony" });
  const ids = within(telephony)
    .getAllByTestId(/^(twilio-card|provider-)/)
    .map((el) => el.dataset.testid);
  expect(ids).toEqual(["twilio-card", "provider-telnyx", "provider-asterisk"]);

  const providers = screen.getByRole("region", { name: "Provider accounts" });
  expect(within(providers).getByTestId("provider-openai")).toBeDefined();
  expect(within(providers).queryByTestId("provider-telnyx")).toBeNull();
  // No Carrier group of its own any more.
  const groupTitles = [...document.querySelectorAll(".int-group-title")].map((el) => el.textContent);
  expect(groupTitles).toEqual(["Model"]);
});

it("connects Telnyx with its API key and public key", async () => {
  cards = [card("telnyx")];
  render(<ProviderAccounts isAdmin />);
  fireEvent.click(within(await screen.findByTestId(`provider-${cards[0].provider}`)).getByText("Connect"));
  const save = screen.getByRole("button", { name: "Save key" }) as HTMLButtonElement;
  fireEvent.change(screen.getByLabelText("telnyx API key"), { target: { value: "KEY123" } });
  expect(save.disabled).toBe(true); // both or nothing: webhooks need the public key
  fireEvent.change(screen.getByLabelText("telnyx Public key"), { target: { value: "cHVi" } });
  fireEvent.click(save);
  await waitFor(() => expect(put()).toBeTruthy());
  expect(put().path).toBe("/integrations/providers/telnyx");
  expect(JSON.parse(String(put().body))).toEqual({ api_key: "KEY123", public_key: "cHVi" });
});

it("connects Asterisk with its ARI login, leaving blank options to TurnCall", async () => {
  cards = [card("asterisk")];
  render(<ProviderAccounts isAdmin />);
  fireEvent.click(within(await screen.findByTestId(`provider-${cards[0].provider}`)).getByText("Connect"));
  const save = screen.getByRole("button", { name: "Save key" }) as HTMLButtonElement;
  fireEvent.change(screen.getByLabelText("asterisk ARI URL"), { target: { value: "https://pbx:8088" } });
  fireEvent.change(screen.getByLabelText("asterisk Username"), { target: { value: "turncall" } });
  expect(save.disabled).toBe(true); // no password yet
  fireEvent.change(screen.getByLabelText("asterisk Password"), { target: { value: "s3cret" } });
  fireEvent.change(screen.getByLabelText("asterisk Transfer context (optional)"), { target: { value: "to-ops" } });
  fireEvent.click(save);
  await waitFor(() => expect(put()).toBeTruthy());
  expect(put().path).toBe("/integrations/providers/asterisk");
  expect(JSON.parse(String(put().body))).toEqual({
    ari_url: "https://pbx:8088",
    username: "turncall",
    password: "s3cret",
    transfer_context: "to-ops",
  });
});

it("a carrier with no account warns about numbers, not agents", async () => {
  cards = [card("telnyx")];
  render(<ProviderAccounts isAdmin />);
  expect(await screen.findByText(/numbers on this carrier can't be bound or answered/)).toBeDefined();
  expect(disconnectText({ ...card("telnyx"), platform_key: true })).toBe("Telnyx numbers then use the platform's account.");
});

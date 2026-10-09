// @vitest-environment jsdom
//
// A workspace's own Telnyx and Asterisk accounts (#75, builder-api#84).
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProviderCard } from "./ProviderAccounts";

const calls: { path: string; method?: string; body?: unknown }[] = [];
let cards: ProviderCard[] = [];

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body });
    if (path === "/integrations/providers") return { data: { providers: cards } };
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

it("files carrier accounts under Carrier, not Model", async () => {
  cards = [card("telnyx"), card("asterisk")];
  render(<ProviderAccounts isAdmin />);
  await screen.findByTestId("provider-telnyx");
  const title = screen.getAllByText("Carrier").find((el) => el.className === "int-group-title")!;
  const group = title.parentElement!;
  expect(within(group).getByTestId("provider-telnyx")).toBeDefined();
  expect(within(group).getByTestId("provider-asterisk")).toBeDefined();
  expect(screen.queryByText("Model")).toBeNull();
});

it("connects Telnyx with its API key and public key", async () => {
  cards = [card("telnyx")];
  render(<ProviderAccounts isAdmin />);
  fireEvent.click(await screen.findByText("Connect"));
  const save = screen.getByRole("button", { name: "Save key" }) as HTMLButtonElement;
  fireEvent.change(screen.getByLabelText("telnyx API key"), { target: { value: "KEY123" } });
  expect(save.disabled).toBe(true); // both or nothing: webhooks need the public key
  fireEvent.change(screen.getByLabelText("telnyx Public key"), { target: { value: "cHVi" } });
  fireEvent.click(save);
  await waitFor(() => expect(put()).toBeTruthy());
  expect(put().path).toBe("/integrations/providers/telnyx");
  expect(JSON.parse(String(put().body))).toEqual({ api_key: "KEY123", public_key: "cHVi" });
});

it("explains why a workspace's own Asterisk can't be connected yet", async () => {
  cards = [card("asterisk")];
  render(<ProviderAccounts isAdmin />);
  fireEvent.click(await screen.findByText("Connect"));
  expect(screen.getByText(/turncall#274/)).toBeDefined();
  expect(screen.queryByRole("button", { name: "Save key" })).toBeNull();
});

it("a carrier with no account warns about numbers, not agents", async () => {
  cards = [card("telnyx")];
  render(<ProviderAccounts isAdmin />);
  expect(await screen.findByText(/numbers on this carrier can't be bound or answered/)).toBeDefined();
  expect(disconnectText({ ...card("telnyx"), platform_key: true })).toBe("Telnyx numbers then use the platform's account.");
});

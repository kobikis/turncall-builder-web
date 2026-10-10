// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProviderCard } from "./ProviderAccounts";

const calls: { path: string; method?: string; body?: unknown }[] = [];
let cards: ProviderCard[] = [];
let adopted: ProviderCard[] = [];

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body });
    if (path === "/integrations/providers") return { data: { providers: cards } };
    if (path.endsWith("/adopt")) return { data: { providers: adopted } };
    return { data: {} };
  }),
  ApiError: class ApiError extends Error {},
}));

import { ProviderAccounts, disconnectText, webhookNumbersText } from "./ProviderAccounts";

const card = (over: Partial<ProviderCard> = {}): ProviderCard => ({
  provider: "deepgram",
  serves: { stt: ["deepgram"], tts: ["deepgram"] },
  connected: false,
  last4: null,
  validation: null,
  disconnecting: false,
  platform_key: true,
  runs_on: "platform",
  agents_using: 3,
  pinned_agents: [],
  agents: [],
  ...over,
});

const show = (isAdmin = true) => render(<ProviderAccounts isAdmin={isAdmin} />);

beforeEach(() => {
  cards = [];
  adopted = [];
});
afterEach(() => {
  calls.length = 0;
  cleanup();
});

it("shows one card per account, tagged with every role it serves", async () => {
  cards = [card()];
  show();
  const el = await screen.findByTestId("provider-deepgram");
  expect(within(el).getByText("STT · TTS")).toBeDefined();
  expect(screen.getAllByTestId(/^provider-/)).toHaveLength(1);
});

it("enters a key through a masked field and never renders a stored one", async () => {
  cards = [card({ connected: true, last4: "wxyz", runs_on: "workspace" })];
  show();
  fireEvent.click(await screen.findByText("Manage"));
  const input = screen.getByLabelText("deepgram API key") as HTMLInputElement;
  expect(input.type).toBe("password");
  expect(input.value).toBe("");
  expect(screen.getAllByText(/····wxyz/).length).toBeGreaterThan(0);

  fireEvent.change(input, { target: { value: "dg-new-secret" } });
  fireEvent.click(screen.getByText("Replace key"));
  await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  const put = calls.find((c) => c.method === "PUT")!;
  expect(put.path).toBe("/integrations/providers/deepgram");
  expect(put.body).toBe(JSON.stringify({ api_key: "dg-new-secret" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.body.textContent).not.toContain("dg-new-secret");
});

it("says which key runs the call: the workspace's, the platform's, or none", async () => {
  cards = [
    card({ provider: "openai", serves: { llm: ["openai"] }, connected: true, last4: "1234", runs_on: "workspace" }),
    card({ provider: "deepgram" }),
    card({ provider: "cartesia", serves: { tts: ["cartesia"] }, platform_key: false, runs_on: "none" }),
  ];
  show();
  expect(await screen.findByText("Calls use this workspace's key ····1234.")).toBeDefined();
  expect(screen.getByText("Calls use the platform's key.")).toBeDefined();
  expect(screen.getByText(/neither this workspace nor the platform/).className).toMatch(/danger/);
});

it("shows a non-admin the status without any control", async () => {
  cards = [card({ connected: true, last4: "1234", runs_on: "workspace", pinned_agents: [{ agent_id: "a", name: "A" }] })];
  show(false);
  await screen.findByText(/····1234/);
  expect(screen.queryByText("Manage")).toBeNull();
  expect(screen.queryByLabelText("deepgram API key")).toBeNull();
  expect(screen.queryByText("Disconnect")).toBeNull();
  expect(screen.queryByText("Adopt into workspace")).toBeNull();
  expect(screen.getByText(/1 agent uses its own key/)).toBeDefined();
});

it("confirms a disconnect that falls back to the platform key", async () => {
  cards = [card({ connected: true, last4: "1234", runs_on: "workspace", agents_using: 2 })];
  show();
  fireEvent.click(await screen.findByText("Manage"));
  fireEvent.click(screen.getByText("Disconnect"));
  const dialog = screen.getByRole("alertdialog");
  expect(dialog.textContent).toMatch(/2 agents use this key/);
  expect(dialog.textContent).toMatch(/fall back to the platform's key/);
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);

  fireEvent.click(screen.getByText("Confirm disconnect"));
  await waitFor(() =>
    expect(calls.find((c) => c.method === "DELETE")?.path).toBe("/integrations/providers/deepgram"),
  );
});

it("confirms a disconnect that will end in failed calls", () => {
  const text = disconnectText(card({ connected: true, platform_key: false, agents_using: 1 }));
  expect(text).toMatch(/1 agent uses this key/);
  expect(text).toMatch(/their calls will fail/);
});

it("leaves the pinned count out rather than saying zero", async () => {
  cards = [card()];
  show();
  await screen.findByTestId("provider-deepgram");
  expect(screen.queryByText(/uses? (its|their) own key/)).toBeNull();
});

it("adopts a pinned agent's key and updates the card in place", async () => {
  cards = [
    card({
      provider: "openai",
      serves: { llm: ["openai"] },
      pinned_agents: [{ agent_id: "a1", name: "Support" }],
    }),
  ];
  adopted = [card({ provider: "openai", serves: { llm: ["openai"] }, connected: true, last4: "abcd", runs_on: "workspace" })];
  show();
  fireEvent.click(await screen.findByText("Connect"));
  fireEvent.click(screen.getByText("Adopt into workspace"));
  expect(await screen.findByText("Calls use this workspace's key ····abcd.")).toBeDefined();
  expect(calls.find((c) => c.path.endsWith("/adopt"))?.body).toBe(JSON.stringify({ agent_id: "a1" }));
  expect(calls.filter((c) => c.path === "/integrations/providers")).toHaveLength(1);
});

it("offers to finish an interrupted disconnect", async () => {
  cards = [
    card({
      connected: false,
      disconnecting: true,
      agents: [{ agent_id: "a2", name: "Sales", state: "remove_failed" }],
    }),
  ];
  show();
  expect(await screen.findByText(/Still holding the key: Sales/)).toBeDefined();
  fireEvent.click(screen.getByText("Manage"));
  fireEvent.click(screen.getByText("Finish disconnecting"));
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
});

it("does not claim calls will fail when the platform key is unknown", () => {
  const text = disconnectText(card({ connected: true, platform_key: null, runs_on: "workspace" }));
  expect(text).toMatch(/could not be checked/);
});

it("files a voice provider under Voice", async () => {
  cards = [card({ provider: "cartesia", serves: { stt: ["cartesia"], tts: ["cartesia"] } })];
  show();
  await screen.findByTestId("provider-cartesia");
  expect(screen.getByText("TTS", { selector: ".int-group-title" })).toBeDefined();
});

it("says when custom call-init numbers are not on the workspace key (builder-api#65)", () => {
  const w = (over: object) => ({ state: "applied", error: null, on_platform_keys: 0, ...over });
  expect(webhookNumbersText(card({ connected: true, webhook_numbers: w({}) }))).toBeNull();
  expect(
    webhookNumbersText(card({ connected: true, webhook_numbers: w({ on_platform_keys: 2 }) })),
  ).toBe("2 custom call-init numbers still run on the platform's key — rebind them to use this one.");
  expect(
    webhookNumbersText(card({ connected: true, webhook_numbers: w({ state: "failed", error: "401" }) })),
  ).toBe("Custom call-init numbers did not get this key (401).");
  // Nothing to say about a key the workspace has not connected.
  expect(webhookNumbersText(card({ connected: false, webhook_numbers: w({ on_platform_keys: 2 }) }))).toBeNull();
});

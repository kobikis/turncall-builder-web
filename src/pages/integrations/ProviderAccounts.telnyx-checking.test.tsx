// @vitest-environment jsdom
//
// While a Telnyx save, replace or retry runs, the server checks every
// bound number against the account (builder-api#114), which can take a while.
// After about a second the card says so, until the request ends (#110).
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ProviderCard } from "./ProviderAccounts";

type Call = { path: string; method?: string; body?: unknown };
type Pending = { call: Call; resolve: (v: unknown) => void; reject: (e: unknown) => void };
let cards: ProviderCard[] = [];
// Writes wait here until the test settles them.
const pending: Pending[] = [];

vi.mock("../../api", () => {
  class ApiError extends Error {
    reason?: string;
    numbers?: string[];
    constructor(message: string, public status: number, extra?: { reason?: string; numbers?: string[] }) {
      super(message);
      this.reason = extra?.reason;
      this.numbers = extra?.numbers;
    }
  }
  return {
    ApiError,
    api: vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/integrations/providers") return { data: { providers: cards } };
      if (path === "/integrations/twilio") return { data: { connected: false, numbers: [] } };
      const call = { path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      return new Promise((resolve, reject) => pending.push({ call, resolve, reject }));
    }),
  };
});

import { ApiError } from "../../api";
import { ProviderAccounts } from "./ProviderAccounts";

const CHECKING = "Checking your bound Telnyx numbers against this account…";
const NUMBERS = ["+15550001111"];

const telnyx = (over: Partial<ProviderCard> = {}): ProviderCard => ({
  provider: "telnyx",
  serves: { carrier: ["telnyx"] },
  connected: false,
  last4: null,
  validation: null,
  disconnecting: false,
  platform_key: true,
  runs_on: "platform",
  agents_using: 0,
  pinned_agents: [],
  agents: [],
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
  pending.length = 0;
  cleanup();
});

const status = (provider = "telnyx") => within(screen.getByTestId(`provider-${provider}`)).queryByRole("status");
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** Settle the oldest pending write and let React render the outcome. */
const settle = async (how: (p: Pending) => void) => {
  await act(async () => {
    how(pending.shift()!);
  });
};

/** Open Telnyx's dialog, fill it in and press Save, with timers faked from the click on. */
const saveTelnyx = async () => {
  render(<ProviderAccounts isAdmin />);
  fireEvent.click(within(await screen.findByTestId("provider-telnyx")).getByText("Connect"));
  fireEvent.change(screen.getByLabelText("telnyx API key"), { target: { value: "KEY123" } });
  fireEvent.change(screen.getByLabelText("telnyx Public key"), { target: { value: "cHVi" } });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
  expect(pending).toHaveLength(1);
};

it("shows the line only after a second, with the button disabled, and clears it on success", async () => {
  cards = [telnyx()];
  await saveTelnyx();

  const button = within(screen.getByRole("dialog")).getByRole("button", { name: "Checking…" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  advance(999);
  expect(status()).toBeNull();
  advance(1);
  expect(status()?.textContent).toBe(CHECKING);
  expect(within(screen.getByRole("dialog")).getByRole("status")).toBeDefined(); // in the dialog
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(pending).toHaveLength(1); // not resubmitted

  await settle((p) => p.resolve({ data: {} }));
  expect(status()).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("clears the line on the numbers_not_on_account warning, and shows it again for Connect anyway", async () => {
  cards = [telnyx()];
  await saveTelnyx();
  advance(1000);
  expect(status()?.textContent).toBe(CHECKING);

  await settle((p) =>
    p.reject(new ApiError("+15550001111 is on another Telnyx account.", 409, { reason: "numbers_not_on_account", numbers: NUMBERS })),
  );
  expect(status()).toBeNull();
  const warning = screen.getByRole("alertdialog");

  fireEvent.click(within(warning).getByLabelText("I understand these numbers will stop answering calls"));
  const anyway = within(warning).getByRole("button", { name: "Connect anyway" }) as HTMLButtonElement;
  fireEvent.click(anyway);
  expect(pending[0].call.body).toEqual({ api_key: "KEY123", public_key: "cHVi", acknowledge_numbers: NUMBERS });
  expect(anyway.disabled).toBe(true);
  advance(999);
  expect(status()).toBeNull();
  advance(1);
  expect(status()?.textContent).toBe(CHECKING);

  await settle((p) => p.resolve({ data: {} }));
  expect(status()).toBeNull();
});

it("clears the line on an error sentence", async () => {
  cards = [telnyx()];
  await saveTelnyx();
  advance(1000);
  expect(status()?.textContent).toBe(CHECKING);

  await settle((p) => p.reject(new ApiError("Telnyx is rate limiting us; try again in about 30 seconds.", 502)));
  expect(status()).toBeNull();
  expect(screen.getByRole("alert").textContent).toBe("Telnyx is rate limiting us; try again in about 30 seconds.");
  expect((screen.getByRole("button", { name: "Save key" }) as HTMLButtonElement).disabled).toBe(false);
});

it("a request that ends within the second never shows the line", async () => {
  cards = [telnyx()];
  await saveTelnyx();
  advance(500);
  await settle((p) => p.reject(new ApiError("Telnyx rejected the API key.", 502)));
  advance(2000);
  expect(status()).toBeNull();
});

it("shows the line on the card for a Retry outside the dialog", async () => {
  cards = [
    telnyx({
      connected: true,
      last4: "9999",
      runs_on: "workspace",
      webhook_numbers: { state: "failed", error: null, on_platform_keys: 0 },
    }),
  ];
  render(<ProviderAccounts isAdmin />);
  const card = await screen.findByTestId("provider-telnyx");
  vi.useFakeTimers();
  const retry = within(card).getByRole("button", { name: "Retry" }) as HTMLButtonElement;
  fireEvent.click(retry);
  expect(pending[0].call.path).toBe("/integrations/providers/telnyx/apply");
  expect(retry.disabled).toBe(true);
  advance(1000);
  expect(status()?.textContent).toBe(CHECKING);
  expect(screen.queryByRole("dialog")).toBeNull();

  await settle((p) => p.resolve({ data: {} }));
  expect(status()).toBeNull();
});

it("never shows the line while adopting an agent's key, which checks no numbers", async () => {
  cards = [telnyx({ pinned_agents: [{ agent_id: "a1", name: "Front desk" }] })];
  render(<ProviderAccounts isAdmin />);
  fireEvent.click(within(await screen.findByTestId("provider-telnyx")).getByText("Connect"));
  vi.useFakeTimers();
  const adopt = screen.getByRole("button", { name: "Adopt into workspace" }) as HTMLButtonElement;
  fireEvent.click(adopt);
  expect(pending[0].call.path).toBe("/integrations/providers/telnyx/adopt");
  expect(adopt.disabled).toBe(true);
  advance(5000);
  expect(screen.queryByText(CHECKING)).toBeNull();

  await settle((p) => p.resolve({ data: { providers: [telnyx({ connected: true, runs_on: "workspace" })] } }));
  expect(status()).toBeNull();
});

it("never shows the line for another provider", async () => {
  cards = [
    {
      provider: "openai",
      serves: { llm: ["openai"] },
      connected: false,
      last4: null,
      validation: null,
      disconnecting: false,
      platform_key: true,
      runs_on: "platform",
      agents_using: 0,
      pinned_agents: [],
      agents: [],
    },
  ];
  render(<ProviderAccounts isAdmin />);
  fireEvent.click(within(await screen.findByTestId("provider-openai")).getByText("Connect"));
  fireEvent.change(screen.getByLabelText("openai API key"), { target: { value: "sk-1" } });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
  expect(pending).toHaveLength(1);
  expect((screen.getByRole("button", { name: "Checking…" }) as HTMLButtonElement).disabled).toBe(true);
  advance(5000);
  expect(status("openai")).toBeNull();
  expect(screen.queryByText(CHECKING)).toBeNull();
  await settle((p) => p.resolve({ data: {} }));
});

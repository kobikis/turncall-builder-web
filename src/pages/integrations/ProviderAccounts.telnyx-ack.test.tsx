// @vitest-environment jsdom
//
// Connecting a Telnyx account that doesn't hold the workspace's bound numbers
// (builder-api#114): the server refuses with the numbers, and the console asks
// for an explicit acknowledgement before resending.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProviderCard } from "./ProviderAccounts";

type Call = { path: string; method?: string; body?: unknown };
const calls: Call[] = [];
let cards: ProviderCard[] = [];
// The refusal for the next write, or null to let it through.
let refuse: ((c: Call) => Error | null) | null = null;

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
      const call = { path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      if (path === "/integrations/providers") return { data: { providers: cards } };
      if (path === "/integrations/twilio") return { data: { connected: false, numbers: [] } };
      calls.push(call);
      const err = refuse?.(call);
      if (err) throw err;
      return { data: {} };
    }),
  };
});

import { ApiError } from "../../api";
import { ProviderAccounts } from "./ProviderAccounts";

const NUMBERS = ["+15550001111", "+15550002222"];
const stranding = (c: Call) =>
  (c.body as { acknowledge_numbers?: string[] } | undefined)?.acknowledge_numbers
    ? null
    : new ApiError("+15550001111 and +15550002222 are on another Telnyx account.", 409, {
        reason: "numbers_not_on_account",
        numbers: NUMBERS,
      });

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
  calls.length = 0;
  refuse = null;
  cleanup();
});

const connect = async () => {
  render(<ProviderAccounts isAdmin />);
  fireEvent.click(within(await screen.findByTestId("provider-telnyx")).getByText("Connect"));
  fireEvent.change(screen.getByLabelText("telnyx API key"), { target: { value: "KEY123" } });
  fireEvent.change(screen.getByLabelText("telnyx Public key"), { target: { value: "cHVi" } });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
};

it("warns about the numbers the new account doesn't hold, and resends with them acknowledged", async () => {
  cards = [telnyx()];
  refuse = stranding;
  await connect();

  const warning = await screen.findByRole("alertdialog", { name: "Numbers not on this Telnyx account" });
  for (const n of NUMBERS) expect(within(warning).getByText(n)).toBeDefined();
  expect(warning.textContent).toContain("will stop answering calls");
  expect(warning.className).toContain("callout warn");

  const anyway = within(warning).getByRole("button", { name: "Connect anyway" }) as HTMLButtonElement;
  expect(anyway.disabled).toBe(true);
  fireEvent.click(within(warning).getByLabelText("I understand these numbers will stop answering calls"));
  expect(anyway.disabled).toBe(false);
  fireEvent.click(anyway);

  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]).toEqual({
    path: "/integrations/providers/telnyx",
    method: "PUT",
    body: { api_key: "KEY123", public_key: "cHVi", acknowledge_numbers: NUMBERS },
  });
  // Saved: the modal closes, and no plain error was ever shown.
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("Cancel discards the warning without resending", async () => {
  cards = [telnyx()];
  refuse = stranding;
  await connect();
  const warning = await screen.findByRole("alertdialog");
  fireEvent.click(within(warning).getByLabelText("I understand these numbers will stop answering calls"));
  fireEvent.click(within(warning).getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(calls).toHaveLength(1);
  expect(screen.getByRole("dialog")).toBeDefined(); // still on the form, to try another key
});

it("re-applying a key asks the same way, and acknowledges on the apply call", async () => {
  cards = [
    telnyx({
      connected: true,
      last4: "9999",
      runs_on: "workspace",
      webhook_numbers: { state: "failed", error: null, on_platform_keys: 0 },
    }),
  ];
  refuse = stranding;
  render(<ProviderAccounts isAdmin />);
  fireEvent.click(within(await screen.findByTestId("provider-telnyx")).getByRole("button", { name: "Retry" }));

  const warning = await screen.findByRole("alertdialog");
  fireEvent.click(within(warning).getByLabelText("I understand these numbers will stop answering calls"));
  fireEvent.click(within(warning).getByRole("button", { name: "Connect anyway" }));
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[0]).toEqual({ path: "/integrations/providers/telnyx/apply", method: "POST", body: undefined });
  expect(calls[1]).toEqual({
    path: "/integrations/providers/telnyx/apply",
    method: "POST",
    body: { acknowledge_numbers: NUMBERS },
  });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});

it.each([
  ["an unrelated 409", new ApiError("A disconnect is still finishing.", 409, {})],
  ["a 409 for another reason", new ApiError("Pick a project first.", 409, { reason: "something_else", numbers: NUMBERS })],
  ["a 502", new ApiError("Telnyx rejected the API key.", 502)],
])("%s still shows as a plain sentence", async (_, err) => {
  cards = [telnyx()];
  refuse = () => err;
  await connect();
  expect((await screen.findByRole("alert")).textContent).toBe(err.message);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

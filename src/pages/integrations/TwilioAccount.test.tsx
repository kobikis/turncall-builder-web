// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const calls: { path: string; method?: string; body?: unknown }[] = [];
let status: unknown = { connected: false, numbers: [] };
let putResult: unknown = { numbers: [] };

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body });
    if (init?.method === "PUT") return { data: putResult };
    return { data: status };
  }),
  ApiError: class ApiError extends Error {},
}));

import { TwilioCard } from "./TwilioAccount";

const AC = "AC" + "e".repeat(32);

beforeEach(() => {
  status = { connected: false, numbers: [] };
  putResult = { numbers: [] };
});
afterEach(() => {
  calls.length = 0;
  cleanup();
});

it("connects with a masked token and never shows it again", async () => {
  render(<TwilioCard isAdmin />);
  fireEvent.click(await screen.findByText("Connect"));
  fireEvent.change(screen.getByLabelText("Twilio Account SID"), { target: { value: AC } });
  const token = screen.getByLabelText("Twilio Auth Token") as HTMLInputElement;
  expect(token.type).toBe("password");
  fireEvent.change(token, { target: { value: "tw-secret" } });
  status = { connected: true, account_sid: AC, last4: "cret", numbers: [] };
  fireEvent.click(screen.getByText("Connect Twilio"));
  await waitFor(() => expect(screen.getByText(/token ····cret/)).toBeDefined());
  expect(JSON.parse(String(calls.find((c) => c.method === "PUT")!.body))).toEqual({
    account_sid: AC,
    auth_token: "tw-secret",
  });
  expect(document.body.textContent).not.toContain("tw-secret");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("says which numbers a rotation could not reach", async () => {
  status = { connected: true, account_sid: AC, last4: "1234", numbers: [{ id: "pn-1", e164: "+1555" }] };
  putResult = { numbers: [{ id: "pn-1", e164: "+1555", state: "failed", error: "not on this account" }] };
  render(<TwilioCard isAdmin />);
  fireEvent.click(await screen.findByText("Manage"));
  fireEvent.change(screen.getByLabelText("Twilio Auth Token"), { target: { value: "new" } });
  fireEvent.click(screen.getByText("Replace"));
  expect(await screen.findByText(/Not updated: \+1555 \(not on this account\)/)).toBeDefined();
});

it("shows a non-admin the status only", async () => {
  status = { connected: true, account_sid: AC, last4: "1234", numbers: [] };
  render(<TwilioCard isAdmin={false} />);
  await screen.findByText(/token ····1234/);
  expect(screen.queryByLabelText("Twilio Auth Token")).toBeNull();
  expect(screen.queryByText("Disconnect")).toBeNull();
});

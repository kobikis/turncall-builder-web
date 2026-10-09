// @vitest-environment jsdom
//
// Calling a number from an agent, and the agent's do-not-call list (#66).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const calls: { path: string; init?: RequestInit }[] = [];
let numbers: Record<string, unknown>[] = [];
let dnc: Record<string, unknown>[] = [];
let outbound: () => unknown = () => ({ data: { id: "c9" } });
let dncTotal = 1;
let refuseAdd = false;

vi.mock("../../api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/phone-numbers") return { data: { phone_numbers: numbers } };
    if (path.endsWith("/calls/outbound")) return outbound();
    if (path.endsWith("/do-not-call") && !init) return { data: dnc, total: dncTotal };
    if (path.endsWith("/do-not-call") && refuseAdd) throw new Error("number: String should match pattern");
    return { data: {} };
  }),
}));

import { CallANumber, DoNotCallList } from "./Outbound";

const sent = (suffix: string) => calls.find((c) => c.path.endsWith(suffix) && c.init?.method);

beforeEach(() => {
  numbers = [
    { id: "pn1", e164: "+15550001111", agent_id: "a1", routing_type: "agent" },
    { id: "pn2", e164: "+15550002222", agent_id: "other", routing_type: "agent" },
    { id: "pn3", e164: "+15550003333", agent_id: "a1", routing_type: "agent", carrier: "asterisk" },
  ];
  dnc = [{ id: "s1", number: "+15553334444", created_at: "2026-10-09T10:00:00Z" }];
  outbound = () => ({ data: { id: "c9" } });
  dncTotal = 1;
  refuseAdd = false;
});
afterEach(() => {
  calls.length = 0;
  cleanup();
});

it("calls a number from one of the agent's own numbers", async () => {
  const onPlaced = vi.fn();
  render(<CallANumber agentId="a1" onPlaced={onPlaced} />);
  const from = await screen.findByLabelText(/call from/i);
  expect(screen.queryByRole("option", { name: /\+15550002222/ })).toBeNull();
  expect(screen.queryByRole("option", { name: /\+15550003333/ })).toBeNull(); // Asterisk dials no one
  expect((from as HTMLSelectElement).value).toBe("pn1");
  fireEvent.change(screen.getByLabelText(/number to call/i), { target: { value: "+15552223333" } });
  fireEvent.click(screen.getByRole("button", { name: /^call$/i }));
  await waitFor(() => expect(onPlaced).toHaveBeenCalled());
  expect(JSON.parse(String(sent("/calls/outbound")!.init!.body))).toEqual({
    from_number_id: "pn1",
    to_number: "+15552223333",
  });
});

it("a suppressed number says so rather than failing generically", async () => {
  outbound = () => {
    throw new Error("+15552223333 is on this agent's do-not-call list.");
  };
  render(<CallANumber agentId="a1" onPlaced={() => {}} />);
  await screen.findByLabelText(/call from/i);
  fireEvent.change(screen.getByLabelText(/number to call/i), { target: { value: "+15552223333" } });
  fireEvent.click(screen.getByRole("button", { name: /^call$/i }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringMatching(/do-not-call list/),
  );
});

it("an agent with no number of its own is told how to get one", async () => {
  numbers = [{ id: "pn2", e164: "+15550002222", agent_id: "other", routing_type: "agent" }];
  render(<CallANumber agentId="a1" onPlaced={() => {}} />);
  expect(await screen.findByText(/no phone number routed to this agent/i)).toBeTruthy();
});

it("lists, adds and removes do-not-call numbers", async () => {
  render(<DoNotCallList agentId="a1" editable />);
  expect(await screen.findByText("+15553334444")).toBeTruthy();

  fireEvent.change(screen.getByLabelText(/add a number/i), { target: { value: "+15556667777" } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  await waitFor(() => expect(sent("/do-not-call")).toBeTruthy());
  expect(JSON.parse(String(sent("/do-not-call")!.init!.body))).toEqual({ number: "+15556667777" });

  fireEvent.click(screen.getByRole("button", { name: /remove \+15553334444/i }));
  await waitFor(() => expect(sent("/do-not-call/s1")?.init?.method).toBe("DELETE"));
});

it("a refused number stays in the box, and a long list says it is cut", async () => {
  refuseAdd = true;
  dncTotal = 250;
  render(<DoNotCallList agentId="a1" editable />);
  expect(await screen.findByText(/newest 1 of 250/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/add a number/i), { target: { value: "555" } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect((screen.getByLabelText(/add a number/i) as HTMLInputElement).value).toBe("555");
});

it("a viewer sees the list but cannot change it", async () => {
  render(<DoNotCallList agentId="a1" editable={false} />);
  expect(await screen.findByText("+15553334444")).toBeTruthy();
  expect(screen.queryByLabelText(/add a number/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
});

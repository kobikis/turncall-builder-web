// @vitest-environment jsdom
//
// The agent's do-not-call list (#66), shown on its Campaigns tab.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const calls: { path: string; init?: RequestInit }[] = [];
let dnc: Record<string, unknown>[] = [];
let dncTotal = 1;
let refuseAdd = false;

vi.mock("../../api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/phone-numbers")
      return {
        data: {
          phone_numbers: [
            { id: "pn1", e164: "+15550001111", agent_id: "a1", routing_type: "agent" },
            { id: "pn2", e164: "+15550002222", agent_id: "other", routing_type: "agent" },
            { id: "pn3", e164: "+15550003333", agent_id: "a1", routing_type: "agent", carrier: "asterisk" },
          ],
        },
      };
    if (path.endsWith("/do-not-call") && !init) return { data: dnc, total: dncTotal };
    if (path.endsWith("/do-not-call") && refuseAdd) throw new Error("number: String should match pattern");
    return { data: {} };
  }),
}));

import { DoNotCallList, useDialingNumbers } from "./Outbound";

const sent = (suffix: string) => calls.find((c) => c.path.endsWith(suffix) && c.init?.method);

beforeEach(() => {
  dnc = [{ id: "s1", number: "+15553334444", created_at: "2026-10-09T10:00:00Z" }];
  dncTotal = 1;
  refuseAdd = false;
});
afterEach(() => {
  calls.length = 0;
  cleanup();
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

it("a campaign dials only from the agent's own numbers, never an Asterisk one", async () => {
  function Dialing() {
    const { numbers } = useDialingNumbers("a1");
    return <p>{numbers ? numbers.map((n) => n.id).join(",") : "loading"}</p>;
  }
  render(<Dialing />);
  expect(await screen.findByText("pn1")).toBeTruthy(); // not pn2 (another agent's), not pn3 (Asterisk)
});

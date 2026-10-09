// @vitest-environment jsdom
//
// An agent's limits (#68): its TurnCall project's, saved on their own.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const calls: { path: string; init?: RequestInit }[] = [];
let stored: Record<string, number | null> = { live_calls: 3, outbound_calls_per_second: null, messages_per_minute: null };
let refuse = "";
let failLoad = false;

vi.mock("../../api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (!init && failLoad) throw new Error("TurnCall is unreachable");
    if (init?.method === "PUT") {
      if (refuse) throw new Error(refuse);
      stored = JSON.parse(String(init.body));
    }
    return { data: stored };
  }),
}));

import { Limits } from "./Limits";

afterEach(() => {
  calls.length = 0;
  refuse = "";
  failLoad = false;
  stored = { live_calls: 3, outbound_calls_per_second: null, messages_per_minute: null };
  cleanup();
});

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const put = () => calls.find((c) => c.init?.method === "PUT");

it("round-trips, and a cleared limit is sent as the platform default", async () => {
  render(<Limits agentId="a1" editable />);
  await waitFor(() => expect(field(/concurrent calls/i).value).toBe("3"));
  expect(field(/messages per minute/i).value).toBe("");

  fireEvent.change(field(/concurrent calls/i), { target: { value: "" } });
  fireEvent.change(field(/outbound calls per second/i), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: /save limits/i }));
  await waitFor(() => expect(put()).toBeTruthy());
  expect(put()!.path).toBe("/agents/a1/limits");
  expect(JSON.parse(String(put()!.init!.body))).toEqual({
    live_calls: null,
    outbound_calls_per_second: 2,
    messages_per_minute: null,
  });
  expect(await screen.findByText(/applies to the next call/i)).toBeTruthy();
});

it("a refused value shows TurnCall's reason", async () => {
  refuse = "live_calls: Input should be greater than or equal to 1";
  render(<Limits agentId="a1" editable />);
  await waitFor(() => expect(field(/concurrent calls/i).value).toBe("3"));
  fireEvent.change(field(/concurrent calls/i), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: /save limits/i }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/greater than or equal to 1/);
});

it("a viewer reads the limits but cannot save them", async () => {
  render(<Limits agentId="a1" editable={false} />);
  await waitFor(() => expect(field(/concurrent calls/i).value).toBe("3"));
  expect(field(/concurrent calls/i).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: /save limits/i })).toBeNull();
});

it("cannot save before the stored limits load, so a failed load never resets them", async () => {
  failLoad = true;
  render(<Limits agentId="a1" editable />);
  expect((await screen.findByRole("alert")).textContent).toMatch(/unreachable/);
  expect((screen.getByRole("button", { name: /save limits/i }) as HTMLButtonElement).disabled).toBe(true);
});

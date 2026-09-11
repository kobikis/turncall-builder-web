// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const calls: { path: string; method?: string; body?: unknown }[] = [];

vi.mock("../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body });
    if (path === "/skills")
      return {
        data: {
          skills: [{ name: "takeaway-orders", description: "when taking orders", body: "b", updated_at: "" }],
          reserved: ["agent-tools", "guardrails"],
        },
      };
    return { data: {} };
  }),
  ApiError: class ApiError extends Error {},
  getActiveWorkspaceId: () => "ws-1",
}));

import Skills from "./Skills";

afterEach(() => {
  calls.length = 0;
  cleanup();
});

it("names the built-in skills so a refused name is explainable", async () => {
  render(<Skills />);
  await waitFor(() => expect(screen.getByText(/agent-tools, guardrails/)).toBeDefined());
  expect(screen.getByText("takeaway-orders")).toBeDefined();
});

it("saves a skill by name", async () => {
  render(<Skills />);
  await waitFor(() => expect(screen.getByText("takeaway-orders")).toBeDefined());

  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "restaurant-reservations" } });
  fireEvent.change(screen.getByLabelText("When should the builder use this?"), {
    target: { value: "Use when taking table bookings" },
  });
  fireEvent.change(screen.getByLabelText("Instructions"), { target: { value: "Ask for covers first." } });
  fireEvent.click(screen.getByRole("button", { name: "Add skill" }));

  await waitFor(() =>
    expect(calls.some((c) => c.path === "/skills/restaurant-reservations" && c.method === "PUT")).toBe(true),
  );
});

it("says an edited skill reaches conversations already open", async () => {
  render(<Skills />);
  await waitFor(() => expect(screen.getByText("takeaway-orders")).toBeDefined());
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "a-skill" } });
  fireEvent.change(screen.getByLabelText("When should the builder use this?"), { target: { value: "d" } });
  fireEvent.change(screen.getByLabelText("Instructions"), { target: { value: "b" } });
  fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
  await waitFor(() => expect(screen.getByText(/already open/)).toBeDefined());
});

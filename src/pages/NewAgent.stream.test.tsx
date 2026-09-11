// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

type Event = Record<string, unknown>;
let events: Event[] = [];

vi.mock("../api", () => ({
  api: vi.fn(async (path: string) => {
    if (path === "/providers/builder") return { data: { providers: [], default: null } };
    if (path === "/sessions") return { data: { session_id: "s1" } };
    throw new Error(`unexpected api call: ${path}`);
  }),
  // Emit synchronously so the progress lines are observable before the result.
  streamEvents: vi.fn(async (_path: string, _body: unknown, onEvent: (e: Event) => void) => {
    for (const e of events) onEvent(e);
  }),
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
  getActiveWorkspaceId: () => "ws-1",
}));

import NewAgent from "./NewAgent";

Element.prototype.scrollTo = vi.fn();

afterEach(() => {
  events = [];
  cleanup();
});

function ask(text: string) {
  render(
    <MemoryRouter>
      <NewAgent />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Describe your agent"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
}

it("shows what the turn is doing, then the question it arrives at", async () => {
  events = [
    { type: "progress", text: "Reading menu.pdf" },
    { type: "progress", text: "Using the takeaway-orders skill", skill: "takeaway-orders" },
    { type: "result", action: "ask", question: "How many covers, typically?" },
  ];
  ask("a room service agent");

  await waitFor(() => expect(screen.getByText("How many covers, typically?")).toBeDefined());
  // The progress is gone once the answer lands — it was the wait, not the answer.
  expect(screen.queryByText(/Reading menu.pdf/)).toBeNull();
});

it("surfaces a failure that arrived after the stream started", async () => {
  events = [
    { type: "progress", text: "Reading menu.pdf" },
    { type: "error", status: 502, detail: "The builder's LLM provider reports no remaining credit." },
  ];
  ask("a room service agent");

  await waitFor(() => expect(screen.getByText(/no remaining credit/)).toBeDefined());
});

it("shows the builder's understanding for checking, and builds nothing yet", async () => {
  events = [
    { type: "progress", text: "Using the agent-tools skill" },
    {
      type: "result",
      action: "confirm",
      summary: "- Books appointments\n- Transfers billing to 020 7946 0321",
    },
  ];
  ask("a dental receptionist");

  await waitFor(() => expect(screen.getByText(/Transfers billing/)).toBeDefined());
  // Flagged as the message to read, not skim.
  expect(screen.getByText("Check this before I build it")).toBeDefined();
  // Nothing to create yet: no config arrived, so Create stays disabled. The
  // confirm step needs no gate of its own — the config not existing is the gate.
  expect(
    (screen.getByRole("button", { name: /Create in TurnCall/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

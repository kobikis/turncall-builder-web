// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// What this file protects: **a derived scenario is a draft, not a test.**
//
// TurnCall captures the call faithfully — including the mistake that made
// someone click the button. Saving one unread produces a test that goes green
// forever while asserting the wrong thing, which is worse than no test. So
// nothing may be stored without a review step, and what gets stored must be
// what was on screen, not a second derive.

const calls: { path: string; method?: string; body?: unknown }[] = [];
let deriveFails: string | null = null;

const DRAFT = {
  name: "call-8c017adc",
  definition: {
    name: "call-8c017adc",
    turns: [
      {
        user: "I'd like to book a table for two on Friday.",
        expect: [
          { event: "llm_response", text_contains: "Booked for two at seven on Friday." },
          { event: "function_call", calls: [{ name: "book_table", args: { day: "friday" } }] },
        ],
      },
    ],
  },
  tool_mocks: { book_table: { status: "confirmed", reference: "APT-9" } },
  tool_policy: "mock_only",
  note: "1 turn(s) and 1 tool mock(s) captured from the call. The conversation is faithful; the expectations are a draft — trim each `text_contains` to the part that actually matters before trusting a green run.",
};

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body });
    if (path.endsWith("/from-call")) {
      if (deriveFails) throw new Error(deriveFails);
      return { data: DRAFT };
    }
    return { data: { id: "s9" } };
  }),
  ApiError: class ApiError extends Error {},
}));

import SaveAsScenario from "./SaveAsScenario";

beforeEach(() => {
  deriveFails = null;
});
afterEach(() => {
  calls.length = 0;
  cleanup();
});

const open = async () => {
  render(<SaveAsScenario agentId="a1" callId="c1" />);
  fireEvent.click(screen.getByText("Save as scenario"));
  await waitFor(() => expect(screen.getByText("Review before saving")).toBeDefined());
};

it("shows the draft for review and stores nothing yet", async () => {
  await open();
  const derive = calls.find((c) => c.path.endsWith("/from-call"))!;
  expect(String(derive.body)).toContain('"save":false');
  expect(calls.some((c) => c.path.endsWith("/eval-scenarios"))).toBe(false);
});

it("shows TurnCall's own wording about the draft, not a gentler paraphrase", async () => {
  await open();
  expect(screen.getByText(/the expectations are a draft/)).toBeDefined();
});

it("shows what each tool returned, because that is what a rerun will return", async () => {
  await open();
  expect(screen.getByText("book_table")).toBeDefined();
  expect(screen.getByText(/APT-9/)).toBeDefined();
});

it("says plainly that the expectations need trimming", async () => {
  await open();
  expect(screen.getByText(/Cut it down to the part that actually matters/)).toBeDefined();
});

it("saves what is on screen, not a second derive", async () => {
  await open();
  const edited = JSON.stringify(
    { name: "books-a-table", turns: [{ user: "book me", expect: [{ event: "llm_response", text_contains: "Booked" }] }] },
    null,
    2
  );
  fireEvent.change(screen.getByLabelText("Turns and expectations"), { target: { value: edited } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "books-a-table" } });
  fireEvent.click(screen.getByText("Save scenario"));

  await waitFor(() => expect(screen.getByText(/Saved\./)).toBeDefined());
  const create = calls.find((c) => c.method === "POST" && c.path.endsWith("/eval-scenarios"))!;
  const body = JSON.parse(String(create.body));
  // The edit survived, and the mocks came along so the scenario is safe to run.
  expect(body.name).toBe("books-a-table");
  expect(body.definition.turns[0].expect[0].text_contains).toBe("Booked");
  expect(body.tool_mocks).toEqual({ book_table: { status: "confirmed", reference: "APT-9" } });
  expect(body.tool_policy).toBe("mock_only");
});

it("refuses to save definition JSON it cannot parse", async () => {
  await open();
  fireEvent.change(screen.getByLabelText("Turns and expectations"), { target: { value: "{not json" } });
  fireEvent.click(screen.getByText("Save scenario"));
  await waitFor(() => expect(screen.getByText(/not valid JSON/)).toBeDefined());
  expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/eval-scenarios"))).toBe(false);
});

it("cancelling leaves nothing behind", async () => {
  await open();
  fireEvent.click(screen.getByText("Cancel"));
  await waitFor(() => expect(screen.getByText("Save as scenario")).toBeDefined());
  expect(calls.some((c) => c.path.endsWith("/eval-scenarios") && c.method === "POST")).toBe(false);
});

it("a call that cannot be converted shows TurnCall's reason", async () => {
  // "convert it once it has ended", "no caller speech to build turns from" —
  // the refusals say what to do about them, so they are not replaced with a
  // generic failure.
  deriveFails = "the call has no caller speech to build turns from";
  render(<SaveAsScenario agentId="a1" callId="c1" />);
  fireEvent.click(screen.getByText("Save as scenario"));
  await waitFor(() => expect(screen.getByText(/no caller speech/)).toBeDefined());
});

it("tells you where it went and what to do next", async () => {
  await open();
  fireEvent.click(screen.getByText("Save scenario"));
  await waitFor(() => expect(screen.getByText(/appears on the Evals tab/)).toBeDefined());
  expect(screen.getByText(/trim the expectations/)).toBeDefined();
});

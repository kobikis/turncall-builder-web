// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Editing a saved scenario (#20). The case it exists for: a derived scenario
// arrives asserting the agent's entire reply, and the moment you want to trim
// that is *after* watching it fail on a rewording. Without this the Console
// can create scenarios it cannot fix.

const calls: { path: string; method?: string; body?: unknown }[] = [];
let saveFails: string | null = null;

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body });
    if (saveFails) throw new Error(saveFails);
    return { data: {} };
  }),
  ApiError: class ApiError extends Error {},
}));

import ScenarioEditor from "./ScenarioEditor";

const SCENARIO = {
  id: "s1",
  name: "asks-for-the-reference",
  tags: ["pre-publish"],
  definition: {
    turns: [
      {
        user: "I need to change my booking.",
        expect: [
          {
            event: "llm_response",
            text_contains: "Of course — could I take your booking reference?",
          },
        ],
      },
    ],
  },
  tool_mocks: { lookup_booking: { found: true } },
};

const saved = vi.fn();
const cancelled = vi.fn();

beforeEach(() => {
  saveFails = null;
});
afterEach(() => {
  calls.length = 0;
  saved.mockClear();
  cancelled.mockClear();
  cleanup();
});

const open = () =>
  render(
    <ScenarioEditor
      agentId="a1"
      scenario={SCENARIO}
      onSaved={saved}
      onCancel={cancelled}
    />
  );

it("opens with what is stored, not a blank form", () => {
  open();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
    "asks-for-the-reference"
  );
  expect((screen.getByLabelText("Tags") as HTMLInputElement).value).toBe("pre-publish");
  expect(screen.getByLabelText("Turns and expectations").textContent).toContain(
    "booking reference"
  );
});

it("shows the tool mocks, because they are what a rerun will return", () => {
  open();
  expect(screen.getByLabelText("Tool mocks").textContent).toContain("lookup_booking");
  expect(screen.getByText(/drifted from what the real tool now returns/)).toBeDefined();
});

it("saves a trimmed expectation through PUT", async () => {
  open();
  const trimmed = JSON.stringify({
    turns: [
      { user: "I need to change my booking.", expect: [{ event: "llm_response", text_contains: "reference" }] },
    ],
  });
  fireEvent.change(screen.getByLabelText("Turns and expectations"), {
    target: { value: trimmed },
  });
  fireEvent.click(screen.getByText("Save"));

  await waitFor(() => expect(saved).toHaveBeenCalled());
  const put = calls.find((c) => c.method === "PUT")!;
  expect(put.path).toBe("/agents/a1/eval-scenarios/s1");
  const body = JSON.parse(String(put.body));
  expect(body.definition.turns[0].expect[0].text_contains).toBe("reference");
});

it("splits tags on commas and drops the blanks", async () => {
  open();
  fireEvent.change(screen.getByLabelText("Tags"), {
    target: { value: "pre-publish, , nightly " },
  });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const body = JSON.parse(String(calls.find((c) => c.method === "PUT")!.body));
  expect(body.tags).toEqual(["pre-publish", "nightly"]);
});

it("refuses malformed turns before sending anything", async () => {
  open();
  fireEvent.change(screen.getByLabelText("Turns and expectations"), {
    target: { value: "{not json" },
  });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() =>
    expect(screen.getByText(/Turns and expectations: not valid JSON/)).toBeDefined()
  );
  expect(calls.some((c) => c.method === "PUT")).toBe(false);
  expect(saved).not.toHaveBeenCalled();
});

it("refuses malformed mocks too, and says which field", async () => {
  open();
  fireEvent.change(screen.getByLabelText("Tool mocks"), { target: { value: "oops" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(screen.getByText(/Tool mocks: not valid JSON/)).toBeDefined());
  expect(calls.some((c) => c.method === "PUT")).toBe(false);
});

it("shows TurnCall's own message when it rejects the definition", async () => {
  // It names the offending field, and that survives the proxy now
  // (builder-api#44). Replacing it with "save failed" would make the Console
  // worse than curl at the moment someone is fixing a scenario.
  saveFails = "<stored scenario>: 'turns:' must be a list";
  open();
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(screen.getByText(/'turns:' must be a list/)).toBeDefined());
  expect(saved).not.toHaveBeenCalled();
});

it("cancelling changes nothing", () => {
  open();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "renamed" } });
  fireEvent.click(screen.getByText("Cancel"));
  expect(cancelled).toHaveBeenCalled();
  expect(calls.some((c) => c.method === "PUT")).toBe(false);
});

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

// --- the judge (turncall#118/#119, #26) -------------------------------------
//
// The judge decides `eval:` expectations and simulation verdicts. Two levels
// exist — this scenario's block, or the platform default — and the form has to
// keep them apart: a blank field that silently means "the default" is how the
// wrong judge runs for a month.

const openWith = (judge: unknown) =>
  render(
    <ScenarioEditor
      agentId="a1"
      scenario={{ ...SCENARIO, judge } as never}
      onSaved={saved}
      onCancel={cancelled}
    />
  );

const body = () => JSON.parse(String(calls[calls.length - 1]?.body));

it("a scenario naming no judge opens on the platform default, not on ollama", () => {
  openWith(null);
  expect((screen.getByLabelText("Judge") as HTMLSelectElement).value).toBe("");
  expect(screen.getByText(/EVAL_JUDGE_PROVIDER/)).toBeTruthy();
  // No model field to fill in: there is nothing to name until a provider is.
  expect(screen.queryByLabelText("Judge model")).toBeNull();
});

it("opens on the judge the scenario actually names", () => {
  openWith({ provider: "openai", model: "gpt-4o", temperature: 0 });
  expect((screen.getByLabelText("Judge") as HTMLSelectElement).value).toBe("openai");
  expect((screen.getByLabelText("Judge model") as HTMLInputElement).value).toBe("gpt-4o");
  expect((screen.getByLabelText("Judge temperature") as HTMLInputElement).value).toBe("0");
});

it("saves the chosen judge as a typed block, never a dotted path", async () => {
  openWith(null);
  fireEvent.change(screen.getByLabelText("Judge"), { target: { value: "openai" } });
  fireEvent.change(screen.getByLabelText("Judge model"), { target: { value: "gpt-4o" } });
  fireEvent.change(screen.getByLabelText("Judge temperature"), { target: { value: "0.2" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(body().judge).toEqual({ provider: "openai", model: "gpt-4o", temperature: 0.2 });
});

it("sends an explicit null to go back to the platform default", async () => {
  // Null is the instruction; omitting the field would leave the judge in place
  // and the reader believing they had removed it (turncall#122).
  openWith({ provider: "openai", model: "gpt-4o" });
  fireEvent.change(screen.getByLabelText("Judge"), { target: { value: "" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(body().judge).toBeNull();
});

it("offers no temperature for a model that rejects one", () => {
  // Claude answers 400 to a temperature, so TurnCall never sends one. A field
  // accepting a number that goes nowhere is worse than no field.
  openWith({ provider: "anthropic" });
  expect(screen.queryByLabelText("Judge temperature")).toBeNull();
  expect(screen.getByText(/Claude rejects a temperature/)).toBeTruthy();
});

it("drops the temperature for an OpenAI reasoning model too", () => {
  openWith({ provider: "openai", model: "gpt-4o", temperature: 0.5 });
  fireEvent.change(screen.getByLabelText("Judge model"), { target: { value: "o3-mini" } });
  expect(screen.queryByLabelText("Judge temperature")).toBeNull();
});

it("says what a hosted judge costs where the choice is made", () => {
  openWith({ provider: "openai" });
  expect(screen.getByText(/costs model time/i)).toBeTruthy();
});

it("names the provider's own default model rather than inventing one", () => {
  openWith({ provider: "openai" });
  expect(
    (screen.getByLabelText("Judge model") as HTMLInputElement).placeholder
  ).toBe("gpt-4o-mini");
});

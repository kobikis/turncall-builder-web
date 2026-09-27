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

const openWith = (judge: unknown, lastRunHarness?: Record<string, unknown> | null) =>
  render(
    <ScenarioEditor
      agentId="a1"
      scenario={{ ...SCENARIO, judge } as never}
      lastRunHarness={lastRunHarness}
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

/** Type a model the provider's shortlist does not name, through "Other…". */
function typeModel(value: string) {
  fireEvent.change(screen.getByLabelText("Judge model"), { target: { value: "__other__" } });
  fireEvent.change(screen.getByLabelText("Judge model"), { target: { value } });
}

it("drops the temperature for an OpenAI reasoning model too", () => {
  openWith({ provider: "openai", model: "gpt-4o", temperature: 0.5 });
  typeModel("o3-mini");
  expect(screen.queryByLabelText("Judge temperature")).toBeNull();
});

it("offers Jev, with no temperature and no wrong explanation", () => {
  // A classifier has no temperature at all. Before it had a branch of its own it
  // fell through to the reasoning-model text and blamed OpenAI for a rule that
  // belongs to neither the provider the author picked nor any model of theirs.
  openWith({ provider: "jev" });
  expect((screen.getByLabelText("Judge") as HTMLSelectElement).value).toBe("jev");
  expect(screen.queryByLabelText("Judge temperature")).toBeNull();
  expect(screen.queryByText(/reasoning models reject a temperature/)).toBeNull();
  expect(screen.getByText(/not a sampler/)).toBeTruthy();
});

it("prices a Jev judge the way it prices every other one", () => {
  // Every sibling branch says what it costs. A judge nobody can price is a judge
  // nobody audits — and a tag fan-out multiplies this one.
  openWith({ provider: "jev" });
  expect(screen.getByText(/Costs a Jev call/)).toBeTruthy();
});

it("offers Jev's own models, with the pinned version as the unset choice", () => {
  // `/v1/models` advertises `jev-latest` and `jev-preview`; pipecat sends a
  // pinned version when no model is named, so that pin is what the empty choice
  // is labelled with — it is what an unset field actually runs.
  openWith({ provider: "jev" });
  const field = screen.getByLabelText("Judge model") as HTMLSelectElement;
  expect([...field.options].map((o) => o.value)).toEqual([
    "",
    "jev-latest",
    "jev-preview",
    "__other__",
  ]);
  expect([...field.options].find((o) => o.value === "")?.textContent).toBe("jev-1.13.0");
});

// A classifier writes no prose, so the reasons come from a second model the
// Console cannot see configured. Three states, and the form reports the one it
// can actually observe rather than restating the rule (turncall#139).
it("says which model actually explained the last run", () => {
  openWith(
    { provider: "jev" },
    {
      judge_provider: "jev",
      explainer_used: true,
      explainer_provider: "openai",
      explainer_model: "gpt-4o-mini",
    }
  );
  expect(screen.getByTestId("jev-reasons").textContent).toBe(
    "Its last run's written reasons came from OpenAI gpt-4o-mini."
  );
});

it("says outright when the last run had no written reasons", () => {
  openWith({ provider: "jev" }, { judge_provider: "jev", explainer_used: false });
  expect(screen.getByTestId("jev-reasons").textContent).toContain(
    "probabilities and no written reasons"
  );
});

it("falls back to the rule only before the first run", () => {
  openWith({ provider: "jev" });
  expect(screen.getByTestId("jev-reasons").textContent).toContain(
    "whatever this TurnCall judges with"
  );
});

it("says nothing about reasons for an LLM judge, which explains itself", () => {
  openWith({ provider: "openai", model: "gpt-4o" });
  expect(screen.queryByTestId("jev-reasons")).toBeNull();
});

it("sends a Jev judge with no temperature at all", () => {
  // Not merely dropped from the form: absent from the payload, so the stored
  // scenario does not carry a number TurnCall would discard on every run.
  openWith({ provider: "jev" });
  fireEvent.click(screen.getByText("Save"));
  expect(body().judge).toEqual({ provider: "jev" });
});

it("clears the model when the provider changes", () => {
  // A model name belongs to one provider. Carrying `gpt-4o` over to Anthropic
  // sent it to Claude, which answers 404 — and the form still showed a model the
  // author had chosen, so nothing pointed at the leftover as the cause.
  openWith({ provider: "openai", model: "gpt-4o", temperature: 0.2 });
  fireEvent.change(screen.getByLabelText("Judge"), { target: { value: "anthropic" } });
  expect((screen.getByLabelText("Judge model") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByText("Save"));
  expect(body().judge).toEqual({ provider: "anthropic" });
});

it("keeps the model when the provider is re-selected unchanged", () => {
  openWith({ provider: "openai", model: "gpt-4o" });
  fireEvent.change(screen.getByLabelText("Judge"), { target: { value: "openai" } });
  expect((screen.getByLabelText("Judge model") as HTMLInputElement).value).toBe("gpt-4o");
});

it("says what a hosted judge costs where the choice is made", () => {
  openWith({ provider: "openai" });
  expect(screen.getByText(/costs model time/i)).toBeTruthy();
});

it("names the provider's own default model rather than inventing one", () => {
  // The empty choice, which is what an unset model runs. Named rather than
  // blank: "the default" on its own is the thing the reader wanted to know.
  openWith({ provider: "openai" });
  const field = screen.getByLabelText("Judge model") as HTMLSelectElement;
  expect(field.value).toBe("");
  expect([...field.options].find((o) => o.value === "")?.textContent).toBe("gpt-4o-mini");
});

it("offers the known models to pick from, and still takes a typed one", () => {
  // A select, because a datalist filters its own options by the field's value
  // and so could not be reopened once one was chosen. The shortlist is still a
  // convenience and not a closed set: a provider ships a new model long before
  // this list hears about it, and an Ollama model is whatever that box serves —
  // which is what "Other…" is for.
  openWith({ provider: "openai" });
  const field = screen.getByLabelText("Judge model") as HTMLSelectElement;
  expect([...field.options].map((o) => o.value)).toContain("gpt-4o-mini");

  typeModel("some-model-we-never-heard-of");
  expect((screen.getByLabelText("Judge model") as HTMLInputElement).value).toBe(
    "some-model-we-never-heard-of"
  );
  fireEvent.click(screen.getByText("Save"));
  expect(body().judge.model).toBe("some-model-we-never-heard-of");
});

it("a chosen model can still be changed to another", () => {
  // The bug this widget exists for: `<input list>` filters its options by the
  // field's own value, so after picking `jev-latest` nothing else matched it and
  // `jev-preview` was unreachable without emptying the field by hand.
  openWith({ provider: "jev" });
  const field = () => screen.getByLabelText("Judge model") as HTMLSelectElement;
  fireEvent.change(field(), { target: { value: "jev-latest" } });
  expect(field().value).toBe("jev-latest");
  expect([...field().options].map((o) => o.value)).toContain("jev-preview");
  fireEvent.change(field(), { target: { value: "jev-preview" } });
  expect(field().value).toBe("jev-preview");
});

it("opens as a text field for a model the provider does not list", () => {
  // Otherwise a scenario judged by something off the shortlist would open on a
  // select that cannot represent it, and saving would silently change the model.
  openWith({ provider: "openai", model: "ft:gpt-4o:acme:custom" });
  const field = screen.getByLabelText("Judge model") as HTMLInputElement;
  expect(field.tagName).toBe("INPUT");
  expect(field.value).toBe("ft:gpt-4o:acme:custom");
});

it("offers Claude's models when the provider is Anthropic", () => {
  openWith({ provider: "anthropic" });
  const field = screen.getByLabelText("Judge model") as HTMLSelectElement;
  expect([...field.options].map((o) => o.value)).toContain("claude-haiku-4-5-20251001");
});

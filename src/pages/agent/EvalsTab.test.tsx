// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The two rules this tab exists to respect, and the reason they are tested
// rather than trusted:
//
//   * `errored` is not `failed`. A judge outage is "could not check", and
//     rendering it as a red cross beside real failures teaches people to
//     distrust the suite — which costs more than the bug it hides.
//   * A viewer reads and cannot run. Running spends model time, so the server
//     403s it; the UI must not offer a button that fails.

let role = "editor";
let scenarios: unknown[] = [];
let runs: unknown[] = [];
const calls: { path: string; method?: string; body?: unknown }[] = [];

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body });
    if (path.endsWith("/eval-scenarios")) return { data: scenarios };
    if (path.endsWith("/eval-runs")) return { data: runs };
    return { data: {} };
  }),
  ApiError: class ApiError extends Error {},
}));

vi.mock("../../auth", () => ({ useAuth: () => ({ activeWorkspace: { role } }) }));
vi.mock("./AgentPage", () => ({ useAgent: () => ({ agentId: "a1" }) }));

import EvalsTab from "./EvalsTab";

const scenario = (over = {}) => ({
  id: "s1",
  name: "asks-for-the-reference",
  kind: "script",
  tags: ["pre-publish"],
  description: null,
  definition: { turns: [{ user: "hi", expect: [] }] },
  tool_mocks: {},
  ...over,
});

const run = (over = {}) => ({
  id: "r1",
  scenario_id: "s1",
  scenario_name: "asks-for-the-reference",
  status: "passed",
  passed_count: 1,
  failed_count: 0,
  iterations: 1,
  error: null,
  batch_id: "b1",
  results: [],
  ...over,
});

beforeEach(() => {
  role = "editor";
  scenarios = [scenario()];
  runs = [];
});

afterEach(() => {
  calls.length = 0;
  cleanup();
});

it("lists the agent's scenarios with their tags", async () => {
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("asks-for-the-reference")).toBeDefined());
  expect(screen.getByText("pre-publish")).toBeDefined();
});

it("says a scenario has never run rather than showing a blank", async () => {
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("never")).toBeDefined());
});

it("an errored run reads as 'could not check', never as a failure", async () => {
  runs = [run({ status: "errored", passed_count: 0, error: "the judge was unreachable" })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByText("Could not check").length).toBeGreaterThan(0));
  // In the rows, not in the document: the status filter legitimately offers
  // "Failed" as a choice, which is not a verdict about this run.
  for (const cell of document.querySelectorAll("td"))
    expect(cell.textContent).not.toBe("Failed");
});

it("an errored run shows no pass count, because there is nothing to count", async () => {
  runs = [run({ status: "errored", passed_count: 0, iterations: 3 })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByText("Could not check").length).toBeGreaterThan(0));
  expect(screen.queryByText("0/3")).toBeNull();
});

it("a failed run is counted out of its iterations, with no score", async () => {
  runs = [run({ status: "failed", passed_count: 7, failed_count: 3, iterations: 10 })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByText("Failed").length).toBeGreaterThan(0));
  expect(screen.getAllByText("7/10").length).toBeGreaterThan(0);
});

it("an editor runs the scenarios they ticked", async () => {
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("asks-for-the-reference")).toBeDefined());
  fireEvent.click(screen.getByLabelText("Select asks-for-the-reference"));
  fireEvent.click(screen.getByText(/Run selected \(1\)/));
  await waitFor(() =>
    expect(calls.some((c) => c.method === "POST" && String(c.body).includes("s1"))).toBe(true)
  );
});

it("a viewer sees the scenarios and is offered no way to run them", async () => {
  role = "viewer";
  runs = [run()];
  render(<EvalsTab />);
  // The name appears twice once a run exists: the scenario row and the run row.
  await waitFor(() =>
    expect(screen.getAllByText("asks-for-the-reference").length).toBeGreaterThan(0)
  );
  expect(screen.queryByText(/^Run selected/)).toBeNull();
  expect(screen.queryByLabelText(/^Select /)).toBeNull();
  // Reading is still fine — the point is the gate, not a blank page.
  expect(screen.getAllByText("Passed").length).toBeGreaterThan(0);
});

it("points at the calls tab when there is nothing to run yet", async () => {
  scenarios = [];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("No scenarios yet.")).toBeDefined());
  expect(screen.getByText(/save it as a scenario/)).toBeDefined();
});

it("a failed run's detail shows what was expected against what was said", async () => {
  runs = [
    run({
      status: "failed",
      passed_count: 0,
      failed_count: 1,
      results: [
        {
          iteration: 1,
          passed: false,
          error: null,
          transcript: [
            { role: "user", content: "I need to change my booking." },
            { role: "assistant", content: "Sure, what date?" },
          ],
          failures: [{ turn_index: 0, event_name: "llm_response", reason: "expected 'reference'" }],
        },
      ],
    }),
  ];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByText("Failed").length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText("Details")[0]);
  await waitFor(() => expect(screen.getByText(/I need to change my booking/)).toBeDefined());
  expect(screen.getByText(/Sure, what date\?/)).toBeDefined();
  expect(screen.getByText(/expected 'reference'/)).toBeDefined();
});

it("an audio run shows what the judge heard and what the model said", async () => {
  runs = [
    run({
      results: [
        {
          iteration: 1,
          passed: true,
          error: null,
          transcript: [{ role: "assistant", content: "Paris?", text: "Paris" }],
          failures: [],
        },
      ],
    }),
  ];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByText("Details").length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText("Details")[0]);
  // The gap between the two is the whole explanation when an audio run fails
  // where a text run passed.
  await waitFor(() => expect(screen.getByText(/Paris\?/)).toBeDefined());
  expect(screen.getByText(/model said: Paris/)).toBeDefined();
});

it("an editor can open a saved scenario to fix it (#20)", async () => {
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("asks-for-the-reference")).toBeDefined());
  fireEvent.click(screen.getByText("Edit"));
  // The editor opens on what is stored — no second fetch, the list carries it.
  await waitFor(() => expect(screen.getByText(/^Edit asks-for-the-reference/)).toBeDefined());
});

it("a viewer is offered no way to change a scenario", async () => {
  role = "viewer";
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("asks-for-the-reference")).toBeDefined());
  expect(screen.queryByText("Edit")).toBeNull();
});

// Dates and tag groups (turncall#68's batch fan-out, surfaced here).
//
// The date is not decoration: "last run: passed" means something different
// depending on whether it was ten minutes ago or before the last three
// deploys. The tag group is not a convenience either — it is the one path that
// produces a *batch*, which is how a group gets a single verdict.

it("shows when a run happened, not only that it did", async () => {
  runs = [run({ completed_at: "2026-09-20T13:10:29Z", queued_at: "2026-09-20T13:09:00Z" })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByTestId("run-when").length).toBeGreaterThan(0));
  const cell = screen.getAllByTestId("run-when")[0];
  expect(cell.textContent).not.toBe("—");
  // The tooltip is unambiguous even where the short form is not.
  expect(cell.getAttribute("title")).toBe("2026-09-20T13:10:29.000Z");
});

it("prefers when the run finished over when it was queued", async () => {
  runs = [run({ queued_at: "2026-09-20T13:00:00Z", completed_at: "2026-09-20T13:10:00Z" })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByTestId("run-when").length).toBeGreaterThan(0));
  expect(screen.getAllByTestId("run-when")[0].getAttribute("title")).toBe(
    "2026-09-20T13:10:00.000Z",
  );
});

it("a run still going shows when it was queued", async () => {
  runs = [run({ status: "running", completed_at: null, queued_at: "2026-09-20T13:00:00Z" })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByTestId("run-when").length).toBeGreaterThan(0));
  expect(screen.getAllByTestId("run-when")[0].getAttribute("title")).toBe(
    "2026-09-20T13:00:00.000Z",
  );
});

it("an older run without timestamps renders a dash, not 'Invalid Date'", async () => {
  runs = [run({ queued_at: undefined, completed_at: undefined })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByTestId("run-when").length).toBeGreaterThan(0));
  expect(screen.getAllByTestId("run-when")[0].textContent).toBe("—");
});

it("runs nothing until something is ticked", async () => {
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText(/Run selected \(0\)/)).toBeDefined());
  const button = screen.getByText(/Run selected \(0\)/) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
});

it("ticks every scenario from the header, and unticks them again", async () => {
  scenarios = [scenario({ id: "s1", name: "one" }), scenario({ id: "s2", name: "two" })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("one")).toBeDefined());
  fireEvent.click(screen.getByLabelText("Select every scenario"));
  expect(screen.getByText(/Run selected \(2\)/)).toBeDefined();
  fireEvent.click(screen.getByLabelText("Select every scenario"));
  expect(screen.getByText(/Run selected \(0\)/)).toBeDefined();
});

it("runs one request per ticked scenario, and none for the rest", async () => {
  scenarios = [scenario({ id: "s1", name: "one" }), scenario({ id: "s2", name: "two" })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("two")).toBeDefined());
  fireEvent.click(screen.getByLabelText("Select two"));
  calls.length = 0;
  fireEvent.click(screen.getByText(/Run selected \(1\)/));
  await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
  const posts = calls.filter((c) => c.method === "POST");
  expect(posts.length).toBe(1);
  expect(JSON.parse(String(posts[0].body))).toEqual({ scenario_id: "s2" });
});

it("no longer offers a per-tag run button", async () => {
  scenarios = [scenario({ tags: ["pre-publish"] })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("asks-for-the-reference")).toBeDefined());
  // The tag still shows as a chip; it is not an action any more.
  expect(screen.getByText("pre-publish")).toBeDefined();
  expect(screen.queryByText(/Run pre-publish/)).toBeNull();
});

// --- who decided the verdict (turncall#118/#119, #26) -----------------------
//
// A verdict without its judge is not comparable across time: a provider-side
// model update moves the whole baseline and nothing on the row says so. Two
// things the tab has to show — which judge a scenario uses, and which one
// actually decided a run.

it("says which judge each scenario uses, and which inherit the default", async () => {
  scenarios = [
    scenario(),
    scenario({ id: "s2", name: "books-a-table", judge: { provider: "openai", model: "gpt-4o" } }),
  ];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("Platform default")).toBeTruthy());
  expect(screen.getByText("OpenAI · gpt-4o")).toBeTruthy();
});

it("a viewer sees the judge and is offered no way to change it", async () => {
  role = "viewer";
  scenarios = [scenario({ judge: { provider: "openai", model: "gpt-4o" } })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("OpenAI · gpt-4o")).toBeTruthy());
  expect(screen.queryByText("Edit")).toBeNull();
});

it("names the judge that decided a run, in its details", async () => {
  runs = [
    run({
      harness_config: {
        judge_used: true,
        judge_provider: "openai",
        judge_model: "gpt-4o",
        judge_temperature: 0,
      },
    }),
  ];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByText("Details").length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText("Details")[0]);
  expect(screen.getByTestId("judged-by").textContent).toContain("OpenAI · gpt-4o");
  expect(screen.getByTestId("judged-by").textContent).toContain("temperature 0");
});

it("does not name a judge that was never asked anything", async () => {
  // Pipecat fills its default judge in whether or not one is ever built, so a
  // scenario of plain text_contains would otherwise credit a model that never
  // ran — which is the same lie as a policy that was never enforced.
  runs = [run({ harness_config: { judge_used: false, judge_service: "ollama" } })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByText("Details").length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText("Details")[0]);
  expect(screen.getByTestId("judged-by").textContent).toContain("No judge was asked");
});

it("flags a run whose judge changed, distinctly from a failure", async () => {
  runs = [
    run({
      status: "failed",
      warnings: [
        {
          code: "judge_changed",
          message: "judge_model 'gemma3' -> 'gpt-4o'",
        },
      ],
    }),
  ];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByTestId("judge-changed")).toBeTruthy());
  // A note, not a verdict: the failure still reads as a failure on its own.
  expect(screen.getByTestId("judge-changed").className).not.toContain("error");
  expect(screen.getByTestId("judge-changed").getAttribute("title")).toContain("gpt-4o");
});

it("a run with nothing to warn about shows no flag", async () => {
  runs = [run()];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByText("Details").length).toBeGreaterThan(0));
  expect(screen.queryByTestId("judge-changed")).toBeNull();
});

it("an agent with no scenarios is not shown an empty judge section", async () => {
  scenarios = [];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("No scenarios yet.")).toBeTruthy());
  expect(screen.queryByTestId("judge-note")).toBeNull();
});

it("puts the judge on the recent runs rows, not only in the details", async () => {
  // Comparing a run with the one above it is the whole point of the list, and
  // two rows decided by different models are not comparable.
  runs = [
    run({
      harness_config: {
        judge_used: true,
        judge_provider: "openai",
        judge_model: "gpt-4o",
        judge_temperature: 0,
      },
    }),
  ];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByTestId("run-judge")).toBeTruthy());
  expect(screen.getByTestId("run-judge").textContent).toContain("gpt-4o");
  expect(screen.getByTestId("run-judge").textContent).toContain("temperature 0");
});

it("an older run with no snapshot shows a dash, not a blank cell", async () => {
  runs = [run({ harness_config: undefined })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByTestId("run-judge")).toBeTruthy());
  expect(screen.getByTestId("run-judge").textContent).toBe("—");
});

it("an audio run's details name the voice and the STT that produced them", async () => {
  // When an audio run fails where a text run passed, this pair is usually the
  // whole explanation (turncall#72).
  runs = [
    run({
      harness_config: {
        judge_used: true,
        judge_provider: "ollama",
        user_speech: { service: "kokoro", voice: "af_heart" },
        bot_transcription: { service: "moonshine" },
      },
    }),
  ];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByText("Details").length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText("Details")[0]);
  const line = screen.getByTestId("heard-through").textContent || "";
  expect(line).toContain("kokoro af_heart");
  expect(line).toContain("moonshine");
});

it("a text run says nothing about voices, because it built none", async () => {
  runs = [run({ harness_config: { judge_used: true, judge_provider: "ollama" } })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getAllByText("Details").length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText("Details")[0]);
  expect(screen.queryByTestId("heard-through")).toBeNull();
});

// --- finding a row among many (#26 follow-up) -------------------------------
//
// Both tables grow without bound — a suite running per PR has hundreds of runs
// inside a month — and the row someone wants is rarely the newest one.

// The runs table specifically: the scenarios table is also on the page, and
// its first column is a checkbox.
const names = (selector: string) =>
  [
    ...(document.querySelector('[data-testid="runs-table"]')?.querySelectorAll(selector) ||
      []),
  ].map((el) => el.textContent);

it("filters scenarios by name", async () => {
  scenarios = [scenario(), scenario({ id: "s2", name: "books-a-table" })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("books-a-table")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Filter scenarios"), { target: { value: "books" } });
  expect(screen.queryByText("asks-for-the-reference")).toBeNull();
  expect(screen.getByText("books-a-table")).toBeTruthy();
});

it("filters scenarios by tag, because a reader does not know which field holds the word", async () => {
  scenarios = [scenario(), scenario({ id: "s2", name: "books-a-table", tags: ["nightly"] })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("books-a-table")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Filter scenarios"), { target: { value: "nightly" } });
  expect(screen.queryByText("asks-for-the-reference")).toBeNull();
});

it("says so when a filter matches nothing, instead of showing an empty table", async () => {
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("asks-for-the-reference")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Filter scenarios"), { target: { value: "zzz" } });
  expect(screen.getByTestId("no-scenario-match")).toBeTruthy();
});

it("sorts scenarios by name, and reverses on a second click", async () => {
  scenarios = [scenario({ id: "s2", name: "books-a-table" }), scenario()];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("books-a-table")).toBeTruthy());
  const first = () =>
    screen.getByTestId("scenarios-table").querySelectorAll("tbody tr td:nth-child(2)")[0]
      ?.textContent;
  expect(first()).toContain("asks-for-the-reference");
  fireEvent.click(within(screen.getByTestId("scenarios-table")).getByText("Scenario"));
  expect(first()).toContain("books-a-table");
});

it("ticking the header box selects what is visible, not what is hidden", async () => {
  // The alternative runs rows the reader cannot see, which is the one thing a
  // filter must never do.
  scenarios = [scenario(), scenario({ id: "s2", name: "books-a-table" })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("books-a-table")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Filter scenarios"), { target: { value: "books" } });
  fireEvent.click(screen.getByLabelText("Select every scenario"));
  expect(screen.getByText("Run selected (1)")).toBeTruthy();
});

it("admits when a ticked scenario is hidden by the filter", async () => {
  scenarios = [scenario(), scenario({ id: "s2", name: "books-a-table" })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("books-a-table")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Select asks-for-the-reference"));
  fireEvent.change(screen.getByLabelText("Filter scenarios"), { target: { value: "books" } });
  // It still runs, so the count must not silently read as the rows on screen.
  expect(screen.getByTestId("hidden-picked").textContent).toContain("1 ticked");
});

it("filters runs by status, in the words the rows use", async () => {
  runs = [
    run({ id: "r1", scenario_name: "one", status: "passed" }),
    run({ id: "r2", scenario_name: "two", status: "errored" }),
  ];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByLabelText("Filter by status")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "errored" } });
  expect(names("tbody tr td:first-child")).toContain("two");
  expect(names("tbody tr td:first-child")).not.toContain("one");
});

it("filters runs by scenario name", async () => {
  runs = [
    run({ id: "r1", scenario_name: "books-a-table" }),
    run({ id: "r2", scenario_name: "cancels-a-booking" }),
  ];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByLabelText("Filter runs")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Filter runs"), { target: { value: "cancels" } });
  expect(names("tbody tr td:first-child")).not.toContain("books-a-table");
});

it("counts what the filter left, against what there is", async () => {
  runs = [run({ id: "r1", status: "passed" }), run({ id: "r2", status: "failed" })];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByLabelText("Filter by status")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "failed" } });
  expect(screen.getByText("1 of 2")).toBeTruthy();
});

it("sorts runs newest first until told otherwise", async () => {
  runs = [
    run({ id: "r1", scenario_name: "older", completed_at: "2026-01-01T00:00:00Z" }),
    run({ id: "r2", scenario_name: "newer", completed_at: "2026-06-01T00:00:00Z" }),
  ];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByLabelText("Filter runs")).toBeTruthy());
  expect(names("tbody tr td:first-child")[0]).toBe("newer");
  fireEvent.click(within(screen.getByTestId("runs-table")).getByText("When"));
  expect(names("tbody tr td:first-child")[0]).toBe("older");
});

it("marks the column actually in force, and only that one", async () => {
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("Scenario")).toBeTruthy());
  const sorted = [...document.querySelectorAll("th[aria-sort]")].filter(
    (th) => th.getAttribute("aria-sort") !== "none"
  );
  expect(sorted.length).toBeGreaterThan(0);
  expect(sorted.every((th) => th.getAttribute("aria-sort") !== "none")).toBe(true);
});

// --- naming the judge a scenario actually ran with ---------------------------
//
// "Platform default" names no model, which is the thing the column exists to
// answer. The last run's snapshot holds it.

it("names the model a scenario was actually judged by, not just 'the default'", async () => {
  scenarios = [scenario({ judge: null })];
  runs = [
    run({
      harness_config: { judge_used: true, judge_provider: "ollama", judge_model: "gemma3" },
    }),
  ];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByTestId("scenario-judge")).toBeTruthy());
  const cell = screen.getByTestId("scenario-judge").textContent || "";
  expect(cell).toContain("Ollama · gemma3");
  // Marked as inherited: it is what ran, not what this scenario chose, and it
  // moves if the platform default moves.
  expect(cell).toContain("inherited");
});

it("a scenario's own judge still wins over what the last run used", async () => {
  // The scenario's block is what the *next* run will use; a stale snapshot
  // must not read as the current setting.
  scenarios = [scenario({ judge: { provider: "openai", model: "gpt-4o" } })];
  runs = [
    run({
      harness_config: { judge_used: true, judge_provider: "ollama", judge_model: "gemma3" },
    }),
  ];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByTestId("scenario-judge")).toBeTruthy());
  const cell = screen.getByTestId("scenario-judge").textContent || "";
  expect(cell).toContain("OpenAI · gpt-4o");
  expect(cell).not.toContain("gemma3");
});

it("a scenario that has never run says only that it inherits", async () => {
  // Honest: the default lives in TurnCall's environment, which the Console
  // cannot read. Naming a model here would be a guess.
  scenarios = [scenario({ judge: null })];
  runs = [];
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByTestId("scenario-judge")).toBeTruthy());
  expect(screen.getByTestId("scenario-judge").textContent).toContain("Platform default");
});

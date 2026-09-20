// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  expect(screen.queryByText("Failed")).toBeNull();
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

it("an editor can run one scenario", async () => {
  render(<EvalsTab />);
  await waitFor(() => expect(screen.getByText("asks-for-the-reference")).toBeDefined());
  fireEvent.click(screen.getByText("Run"));
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
  expect(screen.queryByText("Run")).toBeNull();
  expect(screen.queryByText(/^Run all/)).toBeNull();
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

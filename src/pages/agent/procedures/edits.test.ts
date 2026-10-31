import { expect, it } from "vitest";
import type { Procedure } from "../../../types";
import { addStep, removeStep, renameStep, setStartStep } from "./edits";

const triage = (): Procedure => ({
  name: "triage",
  steps: [
    { id: "greet", kind: "ask", text: "Ask what is wrong.", start: true, moves: [{ to: "check", when: "they describe it" }] },
    { id: "check", kind: "check", text: "Check the line.", moves: [{ to: "done", when: "it is fine" }, { to: "greet", when: "unclear" }] },
    { id: "done", kind: "end", text: "Say goodbye." },
  ],
});

it("renaming a step keeps every move that pointed at it", () => {
  const next = renameStep(triage(), "check", "line_check");
  expect(next.steps.map((s) => s.id)).toEqual(["greet", "line_check", "done"]);
  expect(next.steps[0].moves).toEqual([{ to: "line_check", when: "they describe it" }]);
  expect(next.steps[1].moves).toEqual([{ to: "done", when: "it is fine" }, { to: "greet", when: "unclear" }]);
});

it("a rename leaves the procedure it was given as it was", () => {
  const before = triage();
  renameStep(before, "check", "line_check");
  expect(before).toEqual(triage());
});

it("the start step is one step, picked from the procedure's own", () => {
  const next = setStartStep(triage(), "check");
  expect(next.steps.map((s) => s.start ?? false)).toEqual([false, true, false]);
  expect(next.steps[0]).not.toHaveProperty("start");
});

it("removing a step drops the moves to it, and the start moves to the first step left", () => {
  const next = removeStep(triage(), "greet");
  expect(next.steps.map((s) => s.id)).toEqual(["check", "done"]);
  expect(next.steps[0]).toMatchObject({ start: true, moves: [{ to: "done", when: "it is fine" }] });
});

it("an added step gets an id no other step has, and the first is the start", () => {
  const empty: Procedure = { name: "p", steps: [] };
  const one = addStep(empty);
  expect(one.steps).toEqual([{ id: "step_1", kind: "ask", text: "", start: true }]);
  const two = addStep(addStep(one));
  expect(two.steps.map((s) => s.id)).toEqual(["step_1", "step_2", "step_3"]);
  expect(two.steps[1]).not.toHaveProperty("start");
});

// @vitest-environment jsdom
//
// gpt-live-1 calls no tools itself; it hands them to a delegate configured by
// s2s.delegation (turncall#243). The form edits that one block, and has to emit
// only what TurnCall accepts: blank optional fields are left out, never sent
// as "" (TurnCall refuses an empty reasoning effort or instructions).
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Delegation, type DelegationValue } from "./Delegation";

afterEach(cleanup);

function setup(value: DelegationValue | undefined, hasTools = true) {
  const onChange = vi.fn();
  render(<Delegation value={value} hasTools={hasTools} editable onChange={onChange} />);
  return onChange;
}

const toggle = () => screen.getByLabelText(/delegate tools/i);

it("is off when the agent has no block", () => {
  setup(undefined);
  expect((toggle() as HTMLInputElement).checked).toBe(false);
  expect(screen.queryByLabelText(/delegate model/i)).toBeNull();
});

it("turning it on emits a block TurnCall accepts as-is", () => {
  const onChange = setup(undefined);
  fireEvent.click(toggle());
  expect(onChange).toHaveBeenCalledWith({ mode: "responses", model: "gpt-5-mini" });
});

it("turning it off removes the block", () => {
  const onChange = setup({ mode: "responses", model: "gpt-5-mini" });
  fireEvent.click(toggle());
  expect(onChange).toHaveBeenCalledWith(undefined);
});

it("edits the delegate's settings", () => {
  const onChange = setup({ mode: "responses", model: "gpt-5-mini" });
  fireEvent.change(screen.getByLabelText(/delegate model/i), { target: { value: "gpt-6-astra" } });
  expect(onChange).toHaveBeenLastCalledWith({ mode: "responses", model: "gpt-6-astra" });

  fireEvent.change(screen.getByLabelText(/reasoning effort/i), { target: { value: "low" } });
  expect(onChange).toHaveBeenLastCalledWith({ mode: "responses", model: "gpt-5-mini", reasoning_effort: "low" });

  fireEvent.change(screen.getByLabelText(/timeout/i), { target: { value: "45" } });
  expect(onChange).toHaveBeenLastCalledWith({ mode: "responses", model: "gpt-5-mini", timeout_seconds: 45 });
});

it("clearing an optional field drops it rather than sending an empty string", () => {
  const onChange = setup({
    mode: "responses",
    model: "gpt-5-mini",
    reasoning_effort: "low",
    instructions: "Book weekdays only.",
  });
  fireEvent.change(screen.getByLabelText(/reasoning effort/i), { target: { value: "" } });
  expect(onChange).toHaveBeenLastCalledWith({
    mode: "responses",
    model: "gpt-5-mini",
    instructions: "Book weekdays only.",
  });
  fireEvent.change(screen.getByLabelText(/delegate instructions/i), { target: { value: "" } });
  expect(onChange).toHaveBeenLastCalledWith({ mode: "responses", model: "gpt-5-mini", reasoning_effort: "low" });
});

it("warns that tools will not run when it is off", () => {
  setup(undefined, true);
  expect(screen.getByText(/tools will never run/i)).toBeTruthy();
});

it("says nothing about tools for an agent that has none", () => {
  setup(undefined, false);
  expect(screen.queryByText(/tools will never run/i)).toBeNull();
});

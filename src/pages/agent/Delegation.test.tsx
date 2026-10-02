// @vitest-environment jsdom
//
// gpt-live-1 calls no tools itself; it hands them to a delegate configured by
// s2s.delegation: the agent's own LLM (client, turncall#244, the default) or an
// OpenAI Responses model (turncall#243). The form edits that one block, and has to emit
// only what TurnCall accepts: blank optional fields are left out, never sent
// as "" (TurnCall refuses an empty reasoning effort or instructions).
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Delegation, type DelegationValue } from "./Delegation";

afterEach(cleanup);

function setup(
  value: DelegationValue | undefined,
  hasTools = true,
  models: string[] = [],
  callControl: string[] = [],
) {
  const onChange = vi.fn();
  render(
    <Delegation
      value={value}
      models={models}
      hasTools={hasTools}
      callControl={callControl}
      llmPicker={<span>LLM PICKER</span>}
      editable
      onChange={onChange}
    />,
  );
  return onChange;
}

const mode = () => screen.getByLabelText(/^delegate$/i) as HTMLSelectElement;

it("defaults to the agent's own LLM, showing its picker", () => {
  setup(undefined);
  expect(mode().value).toBe("client");
  expect(screen.getByText("LLM PICKER")).toBeTruthy();
  expect(screen.queryByLabelText(/delegate model/i)).toBeNull();
});

it("choosing a Responses model emits a block TurnCall accepts as-is", () => {
  const onChange = setup(undefined);
  fireEvent.change(mode(), { target: { value: "responses" } });
  expect(onChange).toHaveBeenCalledWith({ mode: "responses", model: "gpt-5-mini" });
});

it("going back to the agent's LLM removes the block", () => {
  const onChange = setup({ mode: "responses", model: "gpt-5-mini" });
  expect(screen.queryByText("LLM PICKER")).toBeNull();
  fireEvent.change(mode(), { target: { value: "client" } });
  expect(onChange).toHaveBeenCalledWith(undefined);
});

it("client mode sends a block only while it carries a setting", () => {
  const onChange = setup(undefined);
  fireEvent.change(screen.getByLabelText(/timeout/i), { target: { value: "60" } });
  expect(onChange).toHaveBeenLastCalledWith({ mode: "client", timeout_seconds: 60 });
  cleanup();
  const again = setup({ mode: "client", timeout_seconds: 60 });
  fireEvent.change(screen.getByLabelText(/timeout/i), { target: { value: "" } });
  expect(again).toHaveBeenLastCalledWith(undefined);
});

it("warns that call control needs a Responses delegate in client mode", () => {
  setup(undefined, true, [], ["end_call"]);
  expect(screen.getByRole("alert").textContent).toMatch(/end_call.*Responses/);
});

it("no call-control warning in responses mode", () => {
  setup({ mode: "responses", model: "gpt-5-mini" }, true, [], ["end_call"]);
  expect(screen.queryByRole("alert")).toBeNull();
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

it("says an agent without tools uses no delegate", () => {
  setup(undefined, false);
  expect(screen.getByText(/no delegate is used/i)).toBeTruthy();
  cleanup();
  setup(undefined, true);
  expect(screen.queryByText(/no delegate is used/i)).toBeNull();
});

it("offers the workspace's OpenAI models to choose from", () => {
  const onChange = setup({ mode: "responses", model: "gpt-5-mini" }, true, ["gpt-5-mini", "gpt-6-astra"]);
  const select = screen.getByLabelText(/delegate model/i) as HTMLSelectElement;
  expect(select.tagName).toBe("SELECT");
  expect([...select.options].map((o) => o.value)).toEqual(["gpt-5-mini", "gpt-6-astra"]);
  fireEvent.change(select, { target: { value: "gpt-6-astra" } });
  expect(onChange).toHaveBeenLastCalledWith({ mode: "responses", model: "gpt-6-astra" });
});

it("keeps a model the list does not carry selectable", () => {
  setup({ mode: "responses", model: "my-fine-tune" }, true, ["gpt-5-mini"]);
  const select = screen.getByLabelText(/delegate model/i) as HTMLSelectElement;
  expect(select.value).toBe("my-fine-tune");
});

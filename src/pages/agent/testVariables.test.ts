// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { filled, loadValues, placeholders, saveValues } from "./testVariables";

afterEach(() => localStorage.clear());

it("finds every placeholder the config uses, once, in order", () => {
  const config = {
    system_prompt: "Ship to {{address}} for {{name}}.",
    first_message: "Hi {{name}}!",
    custom_tools: [{ description: "Look up {{order_id}}" }],
  };
  expect(placeholders(config)).toEqual(["address", "name", "order_id"]);
});

it("ignores what TurnCall would not fill", () => {
  // TurnCall's pattern is \w+ between the braces: no spaces, no dots.
  expect(placeholders({ system_prompt: "{{ name }} {{customer.name}} {name}" })).toEqual([]);
  expect(placeholders(undefined)).toEqual([]);
});

it("sends only the placeholders that have a value", () => {
  const values = { name: "Ada", address: "  ", stale: "from an old prompt" };
  expect(filled(["name", "address"], values)).toEqual({ name: "Ada" });
});

it("keeps values per agent", () => {
  saveValues("a1", { name: "Ada" });
  expect(loadValues("a1")).toEqual({ name: "Ada" });
  expect(loadValues("a2")).toEqual({});
});

it("reads back nothing from storage it cannot parse", () => {
  localStorage.setItem("test-variables:a1", "not json");
  expect(loadValues("a1")).toEqual({});
});

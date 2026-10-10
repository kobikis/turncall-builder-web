import { expect, it } from "vitest";
import { dirtySections, setupChecks } from "./sections";

it("an edit marks the section that owns its key, and only that one", () => {
  expect(dirtySections({ system_prompt: "a" }, { system_prompt: "b" })).toEqual(["prompt"]);
  expect(dirtySections({ llm: { provider: "openai" } }, { llm: { provider: "openai", failover: [{}] } })).toEqual(["models"]);
});

it("a key no form owns is an Advanced edit", () => {
  expect(dirtySections({}, { voicemail: { enabled: true } })).toEqual(["advanced"]);
});

it("key order and an undone edit are not changes", () => {
  expect(dirtySections({ llm: { provider: "x", model: "y" } }, { llm: { model: "y", provider: "x" } })).toEqual([]);
  expect(dirtySections({ tools: ["end_call"] }, { tools: ["end_call"] })).toEqual([]);
});

it("a removed key is a change", () => {
  expect(dirtySections({ avatar: { enabled: true } }, {})).toEqual(["avatar"]);
});

it("setup asks for a backup model on cascade only", () => {
  const done = (c: ReturnType<typeof setupChecks>) => c.map((x) => [x.label, x.done]);
  expect(done(setupChecks("a", { system_prompt: " hi " }, false, 2))).toEqual([
    ["Has a system prompt", true],
    ["Answers on a phone number", false],
    ["Has an eval scenario", true],
    ["Has a backup model", false],
  ]);
  expect(setupChecks("a", { pipeline_mode: "s2s" }, true, 0).map((c) => c.label)).not.toContain("Has a backup model");
});

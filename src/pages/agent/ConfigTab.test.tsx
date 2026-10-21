// @vitest-environment jsdom
//
// The S2S picker for Grok Voice (#113, turncall#384): `xai` is offered, its
// hints are Grok's rather than OpenAI's, and its model and voice pickers read
// builder-api's `xai` catalogs, naming a model xAI has deprecated.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";

let catalogs = false; // false: every list is unavailable, so the fields are free text

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string) => {
    if (catalogs && path === "/providers/s2s/xai/models") {
      return { data: { models: ["grok-voice-3.0", "grok-voice-2.0"], deprecated: ["grok-voice-2.0"] } };
    }
    if (catalogs && path === "/providers/s2s/xai/voices") {
      return { data: { voices: [{ value: "eve", label: "Eve" }, { value: "v-own", label: "My voice" }] } };
    }
    throw new Error("unavailable");
  }),
}));

vi.mock("../../auth", () => ({
  useAuth: () => ({ activeWorkspace: { role: "editor" } }),
}));

let draft: Record<string, unknown> = {};
vi.mock("./AgentPage", () => ({
  useAgent: () => ({ agentId: "a1", data: { backend: null }, draft, patch: () => {}, setDraft: () => {} }),
}));

import ConfigTab from "./ConfigTab";

beforeEach(() => {
  catalogs = false;
  draft = { pipeline_mode: "s2s", s2s: { provider: "xai" } };
});
afterEach(cleanup);

const show = () => render(<ConfigTab section="models" />);

it("offers xai in the S2S picker as Grok Voice", () => {
  show();
  const picker = screen.getByLabelText("S2S provider") as HTMLSelectElement;
  const option = within(picker).getByRole("option", { name: "xai — Grok Voice" }) as HTMLOptionElement;
  expect(option.value).toBe("xai");
  expect(picker.value).toBe("xai");
});

it("hints Grok's model and voice, not OpenAI's", () => {
  show();
  expect((screen.getByLabelText("S2S model") as HTMLInputElement).placeholder).toBe("grok-voice-3.0");
  expect((screen.getByLabelText("Voice") as HTMLInputElement).placeholder).toBe("eve");
});

it("lists the xai catalogs and labels a deprecated model as such", async () => {
  catalogs = true;
  show();
  const model = await waitFor(() => screen.getByRole("combobox", { name: "S2S model" }));
  const models = within(model).getAllByRole("option").map((o) => [(o as HTMLOptionElement).value, o.textContent]);
  expect(models).toEqual([
    ["", "— select —"],
    ["grok-voice-3.0", "grok-voice-3.0"],
    ["grok-voice-2.0", "grok-voice-2.0 (deprecated)"],
  ]);

  const voice = await waitFor(() => screen.getByRole("combobox", { name: "Voice" }));
  expect(within(voice).getByRole("option", { name: "My voice" })).toBeDefined();
  expect((within(voice).getByRole("option", { name: "Eve" }) as HTMLOptionElement).value).toBe("eve");
});

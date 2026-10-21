// @vitest-environment jsdom
//
// The S2S picker for Grok Voice (#113, turncall#384): `xai` is offered, its
// hints are Grok's rather than OpenAI's, and its model and voice pickers read
// builder-api's `xai` catalogs, naming a model xAI has deprecated.
//
// The cascade pickers for xAI (#115, turncall#385): `xai` is offered for STT,
// LLM and TTS, its hints are TurnCall's xAI defaults, its catalogs are listed,
// and the voice speed keeps to the 0.7–1.5 xAI accepts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

let catalogs = false; // false: every list is unavailable, so the fields are free text

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string) => {
    if (catalogs && path === "/providers/s2s/xai/models") {
      return { data: { models: ["grok-voice-3.0", "grok-voice-2.0"], deprecated: ["grok-voice-2.0"] } };
    }
    if (catalogs && path === "/providers/s2s/xai/voices") {
      return { data: { voices: [{ value: "eve", label: "Eve" }, { value: "v-own", label: "My voice" }] } };
    }
    if (catalogs && path === "/providers/llm/xai/models") {
      return { data: { models: ["grok-4.20-non-reasoning", "grok-4.20-reasoning"] } };
    }
    if (catalogs && path === "/providers/stt/xai/models") {
      return { data: { models: ["grok-voice-transcribe-2.0"] } };
    }
    if (catalogs && path === "/providers/tts/xai/voices") {
      return { data: { voices: [{ value: "eve", label: "Eve" }, { value: "rex", label: "Rex" }] } };
    }
    throw new Error("unavailable");
  }),
}));

vi.mock("../../auth", () => ({
  useAuth: () => ({ activeWorkspace: { role: "editor" } }),
}));

type Cfg = Record<string, any>;
let draft: Cfg = {};
let patched: Cfg | null = null; // the draft after the last edit
vi.mock("./AgentPage", () => ({
  useAgent: () => ({
    agentId: "a1",
    data: { backend: null },
    draft,
    patch: (fn: (c: Cfg) => void) => {
      const c = structuredClone(draft);
      fn(c);
      patched = c;
    },
    setDraft: () => {},
  }),
}));

import ConfigTab from "./ConfigTab";

beforeEach(() => {
  catalogs = false;
  patched = null;
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

describe("cascade with xai", () => {
  beforeEach(() => {
    draft = {
      pipeline_mode: "cascade",
      stt: { provider: "xai" },
      llm: { provider: "xai" },
      tts: { provider: "xai" },
    };
  });

  it("offers xai for STT, LLM and TTS under its labels", () => {
    show();
    for (const [picker, label] of [
      ["STT provider", "xai — speech-to-text"],
      ["LLM provider", "xai — Grok"],
      ["TTS provider", "xai — voices"],
    ]) {
      const select = screen.getByLabelText(picker) as HTMLSelectElement;
      const option = within(select).getByRole("option", { name: label }) as HTMLOptionElement;
      expect(option.value).toBe("xai");
      expect(select.value).toBe("xai");
    }
  });

  it("hints TurnCall's xAI defaults and has no TTS model to pick", () => {
    show();
    expect((screen.getByLabelText("STT model") as HTMLInputElement).placeholder).toBe("grok-voice-transcribe-2.0");
    expect((screen.getByLabelText("Model") as HTMLInputElement).placeholder).toBe("grok-4.20-non-reasoning");
    expect((screen.getByLabelText("Voice") as HTMLInputElement).placeholder).toBe("eve");
    expect(screen.queryByLabelText("TTS model")).toBeNull();
  });

  it("lists the xai models and voices from builder-api", async () => {
    catalogs = true;
    show();
    const llm = await waitFor(() => screen.getByRole("combobox", { name: "Model" }));
    expect(within(llm).getByRole("option", { name: "grok-4.20-non-reasoning" })).toBeDefined();
    const stt = await waitFor(() => screen.getByRole("combobox", { name: "STT model" }));
    expect(within(stt).getByRole("option", { name: "grok-voice-transcribe-2.0" })).toBeDefined();
    const voice = await waitFor(() => screen.getByRole("combobox", { name: "Voice" }));
    expect((within(voice).getByRole("option", { name: "Rex" }) as HTMLOptionElement).value).toBe("rex");
  });

  it("keeps the voice speed to xAI's 0.7–1.5", () => {
    show();
    const speed = screen.getByLabelText("Voice speed") as HTMLInputElement;
    expect(speed.min).toBe("0.7");
    expect(speed.max).toBe("1.5");
    expect(screen.getByText(/xAI accepts 0\.7–1\.5/)).toBeDefined();
  });

  it("warns when the speed is outside xAI's range", () => {
    draft = { ...draft, tts: { provider: "xai", speed: 2 } };
    show();
    expect(screen.getByText(/outside the 0\.7–1\.5 xAI accepts/)).toBeDefined();
  });

  it("brings the speed into xAI's range when xAI is picked", () => {
    draft = { ...draft, tts: { provider: "openai", speed: 2.5 } };
    show();
    fireEvent.change(screen.getByLabelText("TTS provider"), { target: { value: "xai" } });
    expect(patched?.tts).toEqual({ provider: "xai", model: "", voice: "", speed: 1.5 });
  });

  it("writes the speed as a number, and a cleared field as no key", () => {
    draft = { ...draft, tts: { provider: "xai", speed: 1.2 } };
    show();
    const speed = screen.getByLabelText("Voice speed") as HTMLInputElement;
    expect(speed.value).toBe("1.2");
    fireEvent.change(speed, { target: { value: "0.9" } });
    expect(patched?.tts).toEqual({ provider: "xai", speed: 0.9 });
    fireEvent.change(speed, { target: { value: "" } });
    expect(patched?.tts).toEqual({ provider: "xai" });
  });

  it("leaves another provider's speed range alone", () => {
    draft = { ...draft, tts: { provider: "openai", speed: 2.5 } };
    show();
    const speed = screen.getByLabelText("Voice speed") as HTMLInputElement;
    expect(speed.min).toBe("0.25");
    expect(speed.max).toBe("4");
    expect(screen.queryByText(/xAI accepts/)).toBeNull();
  });
});

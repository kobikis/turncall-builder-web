// @vitest-environment jsdom
//
// The agent settings builder-api#71 now sends (#63). Each control emits only
// what TurnCall accepts: a cleared field is a removed key — never "" or null —
// while false and 0 are values.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Only Deepgram's voices, OpenAI's TTS models and the HeyGen account's Avatars are live here; every
// other list is unavailable, which leaves that field free text.
vi.mock("../../api", () => ({
  api: vi.fn(async (path: string) => {
    if (path === "/providers/tts/deepgram/voices") {
      return { data: { voices: [{ value: "aura-2-thalia-en", label: "Thalia" }] } };
    }
    if (path === "/providers/tts/openai/models") return { data: { models: ["tts-1", "gpt-4o-mini-tts"] } };
    if (path === "/providers/avatar/heygen/avatars") {
      return { data: { avatars: [{ value: "av-ann", label: "Ann (office)" }] } };
    }
    throw new Error("unavailable");
  }),
}));

import { api } from "../../api";
import { Avatar } from "./Avatar";
import { Backups } from "./Backups";
import { LlmTuning } from "./LlmTuning";
import { parsePronunciations, Pronunciations } from "./Pronunciations";
import { withField } from "./SettingFields";
import { TurnTaking } from "./TurnTaking";

afterEach(cleanup);

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

it("withField removes a cleared key and keeps false and 0", () => {
  expect(withField({ a: 1, b: 2 }, "a", "")).toEqual({ b: 2 });
  expect(withField({ a: 1 }, "a", undefined)).toEqual({});
  expect(withField({}, "a", 0)).toEqual({ a: 0 });
  expect(withField({}, "a", false)).toEqual({ a: false });
});

it("LLM sampling: 0 is a temperature, a cleared one is gone", () => {
  const onChange = vi.fn();
  render(<LlmTuning value={{ provider: "openai", temperature: 0.4 }} onChange={onChange} />);
  type(/temperature/i, "0");
  expect(onChange).toHaveBeenLastCalledWith({ provider: "openai", temperature: 0 });
  type(/temperature/i, "");
  expect(onChange).toHaveBeenLastCalledWith({ provider: "openai" });
});

it("reasoning effort is offered for OpenAI-family providers only", () => {
  const { rerender } = render(<LlmTuning value={{ provider: "openai" }} onChange={() => {}} />);
  expect(screen.queryByLabelText(/reasoning effort/i)).toBeTruthy();
  rerender(<LlmTuning value={{ provider: "anthropic" }} onChange={() => {}} />);
  expect(screen.queryByLabelText(/reasoning effort/i)).toBeNull();
});

it("backups: added, edited, and the last one removed drops the key", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <Backups role="llm" providers={["openai", "anthropic"]} value={undefined} editable onChange={onChange} />,
  );
  fireEvent.click(screen.getByText(/add backup llm/i));
  expect(onChange).toHaveBeenLastCalledWith([{ provider: "openai" }]);

  rerender(
    <Backups role="llm" providers={["openai", "anthropic"]} value={[{ provider: "openai" }]} editable onChange={onChange} />,
  );
  fireEvent.change(screen.getByLabelText(/backup llm 1 provider/i), { target: { value: "anthropic" } });
  expect(onChange).toHaveBeenLastCalledWith([{ provider: "anthropic" }]);
  type(/backup llm 1 model/i, "claude-sonnet-5");
  expect(onChange).toHaveBeenLastCalledWith([{ provider: "openai", model: "claude-sonnet-5" }]);
  fireEvent.click(screen.getByText("Remove"));
  expect(onChange).toHaveBeenLastCalledWith(undefined);
});

it("a TTS backup picks its voice from its provider's live list", async () => {
  const onChange = vi.fn();
  render(<Backups role="tts" providers={["deepgram", "openai"]} value={[{ provider: "deepgram", voice: "alloy" }]} editable onChange={onChange} />);
  await screen.findByRole("option", { name: "Thalia" });
  fireEvent.change(screen.getByLabelText(/backup tts 1 voice/i), { target: { value: "aura-2-thalia-en" } });
  expect(onChange).toHaveBeenLastCalledWith([{ provider: "deepgram", voice: "aura-2-thalia-en" }]);
  // A voice belongs to its provider, so switching drops it.
  fireEvent.change(screen.getByLabelText(/backup tts 1 provider/i), { target: { value: "openai" } });
  expect(onChange).toHaveBeenLastCalledWith([{ provider: "openai" }]);
});

it("a TTS backup picks a model too, except on Deepgram, whose voice is its model", async () => {
  const onChange = vi.fn();
  const { rerender } = render(<Backups role="tts" providers={["deepgram", "openai"]} value={[{ provider: "deepgram" }]} editable onChange={onChange} />);
  expect(screen.queryByLabelText(/backup tts 1 model/i)).toBeNull();
  rerender(<Backups role="tts" providers={["deepgram", "openai"]} value={[{ provider: "openai" }]} editable onChange={onChange} />);
  await screen.findByRole("option", { name: "tts-1" });
  fireEvent.change(screen.getByLabelText(/backup tts 1 model/i), { target: { value: "tts-1" } });
  expect(onChange).toHaveBeenLastCalledWith([{ provider: "openai", model: "tts-1" }]);
});

it("pronunciations: one `word: ipa` per line, half-written lines skipped", () => {
  expect(parsePronunciations("Metformin: mɛtˈfɔɹmɪn\nAcme:\n: x\nnope")).toEqual({
    Metformin: "mɛtˈfɔɹmɪn",
  });
  expect(parsePronunciations("  \n")).toBeUndefined();
});

it("pronunciations show TurnCall's warnings and round-trip their value", () => {
  const onChange = vi.fn();
  render(
    <Pronunciations value={{ Metformin: "metformin" }} warnings={["looks like a spelling"]}
      editable onChange={onChange} />,
  );
  expect((screen.getByLabelText(/pronunciations/i) as HTMLTextAreaElement).value).toBe("Metformin: metformin");
  expect(screen.getByText("looks like a spelling")).toBeTruthy();
  type(/pronunciations/i, "");
  expect(onChange).toHaveBeenLastCalledWith(undefined);
});

it("turn-taking: off is false, back on is TurnCall's default (the key removed)", () => {
  const onSet = vi.fn();
  const { rerender } = render(<TurnTaking cfg={{}} isS2S={false} editable onSet={onSet} />);
  fireEvent.click(screen.getByLabelText(/smart turn \(an ml/i));
  expect(onSet).toHaveBeenLastCalledWith("smart_turn_detection", false);

  rerender(<TurnTaking cfg={{ smart_turn_detection: false }} isS2S={false} editable onSet={onSet} />);
  // Smart Turn off: the silence window is what ends the turn, so it is the field shown.
  expect(screen.getByLabelText(/silence window/i)).toBeTruthy();
  fireEvent.click(screen.getByLabelText(/smart turn \(an ml/i));
  expect(onSet).toHaveBeenLastCalledWith("smart_turn_detection", undefined);
});

it("the greeting can be made uninterruptible, and back is the key removed", () => {
  const onSet = vi.fn();
  const { rerender } = render(<TurnTaking cfg={{}} isS2S={false} editable onSet={onSet} />);
  fireEvent.click(screen.getByLabelText(/interrupt the greeting/i));
  expect(onSet).toHaveBeenLastCalledWith("greeting_interruptible", false);
  rerender(<TurnTaking cfg={{ greeting_interruptible: false }} isS2S={false} editable onSet={onSet} />);
  fireEvent.click(screen.getByLabelText(/interrupt the greeting/i));
  expect(onSet).toHaveBeenLastCalledWith("greeting_interruptible", undefined);
});

it("an idle check-in of 0 turns the guard off rather than reading as blank", () => {
  const onSet = vi.fn();
  render(<TurnTaking cfg={{}} isS2S={false} editable onSet={onSet} />);
  type(/idle check-in \(ms/i, "0");
  expect(onSet).toHaveBeenLastCalledWith("user_idle_timeout_ms", 0);
});

it("speech-to-speech hides the turn-taking controls and says why", () => {
  render(<TurnTaking cfg={{}} isS2S editable onSet={() => {}} />);
  expect(screen.queryByLabelText(/smart turn \(an ml/i)).toBeNull();
  expect(screen.getByText(/realtime model decides/i)).toBeTruthy();
});

it("a Deepgram Flux model owns end-of-turn: Smart Turn and the silence window are not offered", () => {
  const cfg = { stt: { provider: "deepgram", model: "flux-general-en" }, smart_turn_detection: false };
  render(<TurnTaking cfg={cfg} isS2S={false} editable onSet={() => {}} />);
  expect(screen.queryByLabelText(/smart turn \(an ml/i)).toBeNull();
  expect(screen.queryByLabelText(/silence window/i)).toBeNull();
  expect(screen.getByText(/flux decides when the caller has finished/i)).toBeTruthy();
  // Barge-in still applies on Flux.
  expect(screen.getByLabelText(/caller can interrupt the agent/i)).toBeTruthy();
});

// Tavus's list is unavailable here, so its replica ID is typed.
it("avatar: a Tavus replica, and off removes the block", () => {
  const onChange = vi.fn();
  const { rerender } = render(<Avatar value={undefined} editable onChange={onChange} />);
  fireEvent.change(screen.getByLabelText(/video avatar/i), { target: { value: "tavus" } });
  expect(onChange).toHaveBeenLastCalledWith({ enabled: true, provider: "tavus" });

  rerender(<Avatar value={{ enabled: true, provider: "tavus" }} editable onChange={onChange} />);
  type(/replica id/i, "r1");
  expect(onChange).toHaveBeenLastCalledWith({ enabled: true, provider: "tavus", replica_id: "r1" });
  fireEvent.change(screen.getByLabelText(/video avatar/i), { target: { value: "" } });
  expect(onChange).toHaveBeenLastCalledWith(undefined);
});

it("avatar: the HeyGen account's Avatars are offered by name", async () => {
  const onChange = vi.fn();
  render(<Avatar value={{ enabled: true, provider: "heygen", is_sandbox: false }} editable onChange={onChange} />);
  await screen.findByRole("option", { name: "Ann (office)" });
  type(/avatar id/i, "av-ann");
  expect(onChange).toHaveBeenLastCalledWith({ enabled: true, provider: "heygen", is_sandbox: false, avatar_id: "av-ann" });
});

it("avatar: an ID the list does not show can still be typed", async () => {
  // One page of the account's Avatars is listed; an Avatar past it, or one
  // the list leaves out, is pasted by ID.
  const onChange = vi.fn();
  const { rerender } = render(<Avatar value={{ enabled: true, provider: "heygen", is_sandbox: false }} editable onChange={onChange} />);
  await screen.findByRole("option", { name: "Ann (office)" });
  type(/avatar id/i, screen.getByRole("option", { name: /type an avatar id/i }).getAttribute("value")!);
  expect(onChange).not.toHaveBeenCalled(); // choosing to type is not a choice of Avatar

  const typed = screen.getByRole("textbox", { name: /avatar id/i });
  fireEvent.change(typed, { target: { value: "av-past-the-page" } });
  expect(onChange).toHaveBeenLastCalledWith({ enabled: true, provider: "heygen", is_sandbox: false, avatar_id: "av-past-the-page" });

  rerender(<Avatar value={{ enabled: true, provider: "heygen", is_sandbox: false, avatar_id: "av-past-the-page" }} editable onChange={onChange} />);
  fireEvent.blur(screen.getByRole("textbox", { name: /avatar id/i }));
  // Back to the list, which keeps the typed ID as the choice.
  expect((screen.getByLabelText(/avatar id/i) as HTMLSelectElement).value).toBe("av-past-the-page");
  expect(screen.getByRole("option", { name: "Ann (office)" })).toBeTruthy();
});

it("avatar: switching provider refetches, and never offers the other account's Avatars", async () => {
  const { rerender } = render(<Avatar value={{ enabled: true, provider: "heygen", is_sandbox: false }} editable onChange={() => {}} />);
  await screen.findByRole("option", { name: "Ann (office)" });

  vi.mocked(api).mockClear();
  rerender(<Avatar value={{ enabled: true, provider: "tavus" }} editable onChange={() => {}} />);
  expect(screen.queryByRole("option", { name: "Ann (office)" })).toBeNull();
  expect(api).toHaveBeenCalledWith("/providers/avatar/tavus/avatars");
});

it("avatar: a viewer sees the chosen Avatar and cannot change it", async () => {
  render(<Avatar value={{ enabled: true, provider: "heygen", is_sandbox: false, avatar_id: "av-ann" }} editable={false} onChange={() => {}} />);
  await screen.findByRole("option", { name: "Ann (office)" });
  const pick = screen.getByLabelText(/avatar id/i) as HTMLSelectElement;
  expect(pick.value).toBe("av-ann");
  expect(pick.disabled).toBe(true);
});

// LiveAvatar's sandbox runs one Avatar only, and refuses a sandbox session with any other.
const SANDBOX_AVATAR = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";

it("avatar: ticking Sandbox sets the sandbox Avatar and locks the ID", async () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <Avatar value={{ enabled: true, provider: "heygen", is_sandbox: false, avatar_id: "av-ann" }} editable onChange={onChange} />
  );
  await screen.findByRole("option", { name: "Ann (office)" });
  fireEvent.click(screen.getByLabelText(/sandbox/i));
  expect(onChange).toHaveBeenLastCalledWith({ enabled: true, provider: "heygen", is_sandbox: true, avatar_id: SANDBOX_AVATAR });

  rerender(
    <Avatar value={{ enabled: true, provider: "heygen", is_sandbox: true, avatar_id: SANDBOX_AVATAR }} editable onChange={onChange} />
  );
  const id = screen.getByLabelText(/avatar id/i) as HTMLInputElement;
  expect(id.value).toBe(SANDBOX_AVATAR);
  expect(id.readOnly).toBe(true);
  expect(screen.queryByRole("option", { name: "Ann (office)" })).toBeNull();
});

it("avatar: unticking Sandbox clears the sandbox Avatar and offers the account's again", async () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <Avatar value={{ enabled: true, provider: "heygen", is_sandbox: true, avatar_id: SANDBOX_AVATAR }} editable onChange={onChange} />
  );
  fireEvent.click(screen.getByLabelText(/sandbox/i));
  // The sandbox Avatar is refused outside the sandbox, so it is not carried over.
  expect(onChange).toHaveBeenLastCalledWith({ enabled: true, provider: "heygen", is_sandbox: false });

  rerender(<Avatar value={{ enabled: true, provider: "heygen", is_sandbox: false }} editable onChange={onChange} />);
  await screen.findByRole("option", { name: "Ann (office)" });
  type(/avatar id/i, "av-ann");
  expect(onChange).toHaveBeenLastCalledWith({ enabled: true, provider: "heygen", is_sandbox: false, avatar_id: "av-ann" });
});

it("avatar: choosing HeyGen starts in the sandbox, so a key is all the first test call needs", () => {
  const onChange = vi.fn();
  render(<Avatar value={undefined} editable onChange={onChange} />);
  fireEvent.change(screen.getByLabelText(/video avatar/i), { target: { value: "heygen" } });
  expect(onChange).toHaveBeenLastCalledWith({ enabled: true, provider: "heygen", is_sandbox: true, avatar_id: SANDBOX_AVATAR });
});

it("avatar: with no ID the section says it cannot be saved, and stops once there is one", () => {
  const { rerender } = render(<Avatar value={{ enabled: true, provider: "tavus" }} editable onChange={() => {}} />);
  expect(screen.getByText(/choose a replica id.*cannot be saved without one/i)).toBeTruthy();

  rerender(<Avatar value={{ enabled: true, provider: "tavus", replica_id: "r1" }} editable onChange={() => {}} />);
  expect(screen.queryByText(/cannot be saved without one/i)).toBeNull();

  rerender(<Avatar value={{ enabled: true, provider: "heygen", is_sandbox: false }} editable onChange={() => {}} />);
  expect(screen.getByText(/choose an avatar id.*cannot be saved without one/i)).toBeTruthy();
});

it("avatar: the hint says a sandbox session is short and free, and where an Avatar shows", () => {
  const { rerender } = render(
    <Avatar value={{ enabled: true, provider: "heygen", is_sandbox: true, avatar_id: SANDBOX_AVATAR }} editable onChange={() => {}} />
  );
  expect(screen.getByText(/sandbox.*about a minute.*free/i)).toBeTruthy();
  expect(screen.getByText(/only on browser calls/i)).toBeTruthy();
  // Speech-to-speech Agents run an Avatar too (kobikis/turncall#401).
  expect(screen.queryByText(/speech-to-speech/i)).toBeNull();
  expect(screen.queryByText(/hearing, thinking and speaking stages/i)).toBeNull();

  rerender(<Avatar value={{ enabled: true, provider: "tavus", replica_id: "r1" }} editable onChange={() => {}} />);
  expect(screen.queryByText(/about a minute/i)).toBeNull();
  expect(screen.getByText(/only on browser calls/i)).toBeTruthy();
});

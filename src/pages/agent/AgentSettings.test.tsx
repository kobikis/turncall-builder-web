// @vitest-environment jsdom
//
// The agent settings builder-api#71 now sends (#63). Each control emits only
// what TurnCall accepts: a cleared field is a removed key — never "" or null —
// while false and 0 are values.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

it("a TTS backup names a voice", () => {
  render(<Backups role="tts" providers={["deepgram"]} value={[{ provider: "deepgram" }]} editable onChange={() => {}} />);
  expect(screen.getByLabelText(/backup tts 1 voice/i)).toBeTruthy();
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

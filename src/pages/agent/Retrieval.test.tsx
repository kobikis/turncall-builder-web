// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// How the agent reads its documents: all of them every turn, a search each
// turn, or a search when the model decides. Measured on a 16.7k-character
// menu, reading all of it cost about a second of LLM time a turn — so the
// picker says when "whole documents" is too big.

const calls: { path: string; body?: unknown }[] = [];
vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body });
    return { data: JSON.parse(String(init?.body)) };
  }),
}));

import Retrieval, { RetrievalSetting } from "./Retrieval";

afterEach(() => {
  calls.length = 0;
  cleanup();
});

function show(over: Partial<Parameters<typeof Retrieval>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <Retrieval
      agentId="a1"
      setting={{ mode: "prompt" } as RetrievalSetting}
      totalChars={1200}
      speechToSpeech={false}
      editable
      onChange={onChange}
      {...over}
    />,
  );
  return onChange;
}

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

it("marks the mode the agent reads its documents in", () => {
  show({ setting: { mode: "auto" } });
  expect(button("Search each turn").getAttribute("aria-pressed")).toBe("true");
  expect(button("Whole documents").getAttribute("aria-pressed")).toBe("false");
});

it("changes the mode through the agent's retrieval endpoint", async () => {
  const onChange = show();
  fireEvent.click(button("Search each turn"));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ mode: "auto" }));
  expect(calls).toEqual([{ path: "/agents/a1/knowledge/retrieval", body: '{"mode":"auto"}' }]);
});

it("says whole documents are slowing replies once they are large", () => {
  show({ totalChars: 16652 });
  expect(screen.getByText(/Every reply reads all 16,652 characters/)).toBeDefined();
});

it("says nothing about size while whole documents are small", () => {
  show({ totalChars: 1200 });
  expect(screen.queryByText(/Every reply reads all [0-9]/)).toBeNull();
});

it("offers no per-turn search on a speech-to-speech agent", () => {
  show({ speechToSpeech: true, totalChars: 16652 });
  expect(button("Search each turn").disabled).toBe(true);
  // ...and the size warning points at the mode that does work there.
  expect(screen.getByText(/Agent searches sends only what the question needs/)).toBeDefined();
});

it("is read-only for a viewer", () => {
  show({ editable: false });
  expect(button("Search each turn").disabled).toBe(true);
});

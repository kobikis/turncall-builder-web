// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Doc } from "../../types";

// How the agent reads each document: whole in every reply, a search each
// turn, or a search when the model decides. Per document, because each has a
// knowledge base of its own (builder-api ADR-0024). Measured on a
// 16.7k-character menu, reading it whole cost about a second a turn — so a
// large document read whole says so.

const calls: { path: string; body?: unknown }[] = [];
vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body });
    return { data: JSON.parse(String(init?.body)) };
  }),
}));

import DocumentRetrieval from "./Retrieval";

afterEach(() => {
  calls.length = 0;
  cleanup();
});

const doc = (over: Partial<Doc> = {}): Doc => ({
  id: "d1",
  filename: "menu.pdf",
  content_type: "application/pdf",
  char_count: 1200,
  chunk_count: 3,
  status: "ready",
  error_message: null,
  created_at: "2026-10-10T00:00:00Z",
  retrieval: { mode: "prompt" },
  ...over,
});

function show(over: Partial<Parameters<typeof DocumentRetrieval>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <DocumentRetrieval agentId="a1" doc={doc()} speechToSpeech={false} editable onChange={onChange} {...over} />,
  );
  return onChange;
}

const picker = () => screen.getByLabelText("How the agent reads menu.pdf") as HTMLSelectElement;
const option = (label: string) => screen.getByRole("option", { name: label }) as HTMLOptionElement;

it("shows how this document is read", () => {
  show({ doc: doc({ retrieval: { mode: "auto" } }) });
  expect(picker().value).toBe("auto");
});

it("reads a document with no link yet as whole", () => {
  show({ doc: doc({ retrieval: null }) });
  expect(picker().value).toBe("prompt");
});

it("changes this document's mode, and only through its own endpoint", async () => {
  const onChange = show();
  fireEvent.change(picker(), { target: { value: "auto" } });
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ mode: "auto" }));
  expect(calls).toEqual([{ path: "/agents/a1/knowledge/documents/d1/retrieval", body: '{"mode":"auto"}' }]);
});

it("says a large document read whole is slowing replies", () => {
  show({ doc: doc({ char_count: 16652 }) });
  expect(screen.getByText(/Every reply reads all 16,652 characters/)).toBeDefined();
});

it("says nothing while the document is small, or not read whole", () => {
  show({ doc: doc({ char_count: 1200 }) });
  expect(screen.queryByText(/Every reply reads all/)).toBeNull();
  cleanup();
  show({ doc: doc({ char_count: 16652, retrieval: { mode: "auto" } }) });
  expect(screen.queryByText(/Every reply reads all/)).toBeNull();
});

it("offers no per-turn search on a speech-to-speech agent", () => {
  show({ speechToSpeech: true, doc: doc({ char_count: 16652 }) });
  expect(option("Search each turn").disabled).toBe(true);
  expect(screen.getByText(/Agent searches sends only what's needed/)).toBeDefined();
});

it("is read-only for a viewer", () => {
  show({ editable: false });
  expect(picker().disabled).toBe(true);
});

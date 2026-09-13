// @vitest-environment jsdom
//
// The disclosure itself: open by default, and the choice survives the remount
// that a tab switch causes. Everything a section is *used* for is tested where
// it is used.
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Section } from "./Section";

const details = (title: string) => screen.getByText(title).closest("details")!;

function collapse(title: string) {
  const el = details(title);
  el.open = false;
  fireEvent(el, new Event("toggle"));
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("is open until someone says otherwise", () => {
  // A Console that hides its own form until you find the toggles is worse than
  // a long one.
  render(<Section id="a" title="Prompt">body</Section>);
  expect(details("Prompt").open).toBe(true);
});

it("stays shut across a remount", () => {
  // ConfigTab unmounts on every tab switch, so a choice that does not survive
  // one is not a choice.
  render(<Section id="a" title="Prompt">body</Section>);
  collapse("Prompt");
  cleanup();

  render(<Section id="a" title="Prompt">body</Section>);
  expect(details("Prompt").open).toBe(false);
});

it("remembers each section separately", () => {
  render(
    <>
      <Section id="a" title="Prompt">one</Section>
      <Section id="b" title="Guardrails">two</Section>
    </>,
  );
  collapse("Prompt");
  cleanup();

  render(
    <>
      <Section id="a" title="Prompt">one</Section>
      <Section id="b" title="Guardrails">two</Section>
    </>,
  );
  expect(details("Prompt").open).toBe(false);
  expect(details("Guardrails").open).toBe(true);
});

it("shows a hint beside the title so a shut section still says something", () => {
  render(<Section id="a" title="MCP servers" hint={3}>body</Section>);
  expect(screen.getByText(/· 3/)).toBeTruthy();
});

it("shows no separator when there is nothing to hint at", () => {
  render(<Section id="a" title="MCP servers" hint="">body</Section>);
  expect(screen.queryByText(/·/)).toBeNull();
});

it("honours a section that asks to start shut", () => {
  render(<Section id="a" title="Prompt" defaultOpen={false}>body</Section>);
  expect(details("Prompt").open).toBe(false);
});

it("lets a remembered choice beat the default", () => {
  localStorage.setItem("turncall.section.a", "1");
  render(<Section id="a" title="Prompt" defaultOpen={false}>body</Section>);
  expect(details("Prompt").open).toBe(true);
});

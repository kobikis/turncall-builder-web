// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let broken = true;
function Page() {
  if (broken) throw new RangeError("Invalid time value");
  return <p>the page</p>;
}

it("a page that throws while rendering shows why instead of a blank console, and can be retried", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  broken = true;
  render(
    <MemoryRouter>
      <ErrorBoundary resetKey="/members/audit">
        <Page />
      </ErrorBoundary>
    </MemoryRouter>,
  );
  expect(screen.getByRole("alert").textContent).toMatch(/could not be shown.*Invalid time value/);
  expect(screen.getByRole("link", { name: "Go to Agents" })).toBeTruthy();
  broken = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("the page")).toBeTruthy();
});

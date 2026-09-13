// @vitest-environment jsdom
//
// Minimizing the section. The rules worth pinning: it stays minimized across
// page loads, a collapsed heading still says whether anything is attached, and
// an unmet need is never what gets hidden.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../api", () => ({
  ApiError: class extends Error {},
  api: vi.fn(async () => ({ data: [] })),
}));

const { ConnectedApps } = await import("./ConnectedApps");

const CATALOG = [
  { app: "slack_v2", name: "Slack", tools: ["slack_v2-post-message"], actions: [] },
  { app: "google_calendar", name: "Google Calendar", tools: [], actions: [] },
];
const CONNECTED = [{ id: "apn_1", app: "slack_v2" }];

function show(props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <ConnectedApps
        apps={[]}
        catalog={CATALOG}
        connected={CONNECTED}
        editable
        onChange={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

const section = () => screen.getByText("Connected apps").closest("details")!;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("starts expanded", () => {
  show();
  expect(section().open).toBe(true);
});

it("stays minimized across page loads", () => {
  // A preference re-asked on every visit is not a preference.
  show();
  const details = section();
  details.open = false;
  fireEvent(details, new Event("toggle"));
  cleanup();

  show();
  expect(section().open).toBe(false);
});

it("says how many apps are in use while minimized", () => {
  // Otherwise minimizing is a choice between the grid and knowing whether
  // anything is attached at all.
  show({ apps: ["slack_v2"] });
  expect(screen.getByText(/1 in use/)).toBeTruthy();
});

it("says nothing about a count when nothing is attached", () => {
  show();
  expect(screen.queryByText(/in use/)).toBeNull();
});

it("keeps an unmet need visible when minimized", () => {
  // The callout is a call to action. Minimizing the section must not be a way
  // to lose it, so it sits outside the collapsible part.
  localStorage.setItem("turncall.connectedApps.open", "0");
  show({ needs: ["google_calendar"] });
  const callout = screen.getByText(/This agent needs Google Calendar/);
  expect(section().open).toBe(false);
  expect(callout.closest("details")).toBeNull();
});

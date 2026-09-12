// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ConnectedApps, pickable } from "./ConnectedApps";

afterEach(cleanup);

const CATALOG = [
  {
    app: "slack_v2",
    name: "Slack",
    tools: ["slack_v2-post-message", "slack_v2-list-channels"],
  },
  {
    app: "google_calendar",
    name: "Google Calendar",
    tools: ["google_calendar-create-event"],
  },
];

const CONNECTED = [
  { id: "apn_1", app: "slack_v2" },
  { id: "apn_2", app: "google_calendar" },
];

function show(props: Partial<Parameters<typeof ConnectedApps>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <ConnectedApps
      apps={[]}
      catalog={CATALOG}
      connected={CONNECTED}
      editable
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

// The states worth pinning are the ones where an editor could lose an
// attachment, be shown something they cannot use, or be stuck with an app they
// can no longer take off.

describe("which apps are offered", () => {
  it("offers what the workspace has connected", () => {
    expect(pickable([], CATALOG, CONNECTED).map((a) => a.app)).toEqual([
      "slack_v2",
      "google_calendar",
    ]);
  });

  it("keeps an attached app that has since been disconnected", () => {
    // Otherwise it stays attached to the agent with no way to take it off.
    const rows = pickable(["slack_v2"], CATALOG, []);
    expect(rows.map((a) => a.app)).toEqual(["slack_v2"]);
  });

  it("does not list the same app twice when it is attached and connected", () => {
    expect(pickable(["slack_v2"], CATALOG, CONNECTED)).toHaveLength(2);
  });

  it("survives an app the catalog has never heard of", () => {
    const rows = pickable(["dropbox"], CATALOG, []);
    expect(rows[0]).toEqual({ app: "dropbox", name: "dropbox", tools: [] });
  });
});

describe("the picker", () => {
  it("attaches an app without disturbing the others", () => {
    const onChange = show({ apps: ["slack_v2"] });

    fireEvent.click(screen.getByLabelText(/Google Calendar/));

    expect(onChange).toHaveBeenCalledWith(["slack_v2", "google_calendar"]);
  });

  it("detaches an app", () => {
    const onChange = show({ apps: ["slack_v2", "google_calendar"] });

    fireEvent.click(screen.getByLabelText(/^Slack/));

    expect(onChange).toHaveBeenCalledWith(["google_calendar"]);
  });

  it("shows what an attached app gives the agent", () => {
    show({ apps: ["slack_v2"] });

    // Named without the app prefix, which is noise to a reader.
    expect(screen.getByText(/post-message, list-channels/)).toBeTruthy();
    // Not for an app that is merely available.
    expect(screen.queryByText(/create-event/)).toBeNull();
  });

  it("says so when an attached app is no longer connected", () => {
    show({ apps: ["slack_v2"], connected: [{ id: "apn_2", app: "google_calendar" }] });

    expect(screen.getByText(/no longer connected/)).toBeTruthy();
  });

  it("renders without error when nothing is connected", () => {
    show({ connected: [], catalog: [] });

    expect(screen.getByText(/No apps connected yet/)).toBeTruthy();
  });
});

describe("a viewer", () => {
  it("sees the list with no control they can use", () => {
    show({ apps: ["slack_v2"], editable: false });

    expect(screen.getByText(/Slack/)).toBeTruthy();
    for (const box of screen.getAllByRole("checkbox")) {
      expect((box as HTMLInputElement).disabled).toBe(true);
    }
  });

  it("cannot change an attachment", () => {
    const onChange = show({ apps: [], editable: false });

    fireEvent.click(screen.getByLabelText(/^Slack/));

    expect(onChange).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  ConnectedApps,
  pickable,
  readAttachment,
  writeAttachment,
  type AttachmentValue,
} from "./ConnectedApps";

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

const SUMMARY = {
  app: "slack_v2",
  call_ended: {
    action: "slack_v2-post-message",
    args: { channel: "#calls" },
    summary_arg: "text",
  },
};

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

const duringCalls = (name: string) => screen.getByLabelText(`${name}: available during calls`);
const whenEnds = (name: string) => screen.getByLabelText(`${name}: when a call ends`);

// The states worth pinning are the ones where an editor could lose an
// attachment, be shown something they cannot use, or silently get a trigger
// they did not ask for.

describe("which apps are offered", () => {
  it("offers what the workspace has connected", () => {
    expect(pickable([], CATALOG, CONNECTED).map((a) => a.app)).toEqual([
      "slack_v2",
      "google_calendar",
    ]);
  });

  it("keeps an attached app that has since been disconnected", () => {
    // Otherwise it stays attached to the agent with no way to take it off.
    expect(pickable(["slack_v2"], CATALOG, []).map((a) => a.app)).toEqual(["slack_v2"]);
  });

  it("does not list the same app twice when it is attached and connected", () => {
    expect(pickable(["slack_v2"], CATALOG, CONNECTED)).toHaveLength(2);
  });

  it("survives an app the catalog has never heard of", () => {
    expect(pickable(["dropbox"], CATALOG, [])[0]).toEqual({
      app: "dropbox",
      name: "dropbox",
      tools: [],
    });
  });

  it("finds an app attached in the object form", () => {
    expect(pickable([SUMMARY], CATALOG, []).map((a) => a.app)).toEqual(["slack_v2"]);
  });
});

describe("reading an attachment", () => {
  it("reads a bare slug as mid-call only", () => {
    // The pre-ADR-0021 shape. Reading it as anything else would turn on an
    // end-of-call trigger for an agent whose owner never asked for one.
    expect(readAttachment("slack_v2")).toEqual({
      app: "slack_v2",
      midCall: true,
      callEnded: null,
    });
  });

  it("reads the object form", () => {
    const parsed = readAttachment(SUMMARY);
    expect(parsed.midCall).toBe(false);
    expect(parsed.callEnded?.action).toBe("slack_v2-post-message");
  });

  it("drops an end-of-call half with no action", () => {
    const parsed = readAttachment({ app: "slack_v2", mid_call: true, call_ended: undefined });
    expect(parsed.callEnded).toBeNull();
  });

  it("writes nothing at all when neither trigger is set", () => {
    // An entry with no trigger reads as attached while doing nothing, and the
    // API refuses it.
    expect(writeAttachment({ app: "slack_v2", midCall: false, callEnded: null })).toBeNull();
  });
});

describe("choosing when an app runs", () => {
  it("turns on mid-call without disturbing the others", () => {
    const onChange = show({ apps: ["slack_v2"] });

    fireEvent.click(duringCalls("Google Calendar"));

    expect(onChange).toHaveBeenCalledWith([
      "slack_v2",
      { app: "google_calendar", mid_call: true },
    ]);
  });

  it("turns off mid-call, removing an app that has no other trigger", () => {
    const onChange = show({ apps: ["slack_v2", "google_calendar"] });

    fireEvent.click(duringCalls("Slack"));

    expect(onChange).toHaveBeenCalledWith(["google_calendar"]);
  });

  it("keeps an app attached when mid-call goes off but an Automation stays", () => {
    const onChange = show({ apps: [{ ...SUMMARY, mid_call: true }] });

    fireEvent.click(duringCalls("Slack"));

    expect(onChange).toHaveBeenCalledWith([SUMMARY]);
  });

  it("sets an end-of-call action on an app that was not attached at all", () => {
    const onChange = show({ apps: [] });

    fireEvent.change(whenEnds("Slack"), { target: { value: "slack_v2-post-message" } });

    expect(onChange).toHaveBeenCalledWith([
      {
        app: "slack_v2",
        call_ended: { action: "slack_v2-post-message", args: {}, summary_arg: "" },
      },
    ]);
  });

  it("choosing 'Do nothing' clears the Automation but keeps mid-call", () => {
    const onChange = show({ apps: [{ ...SUMMARY, mid_call: true }] });

    fireEvent.change(whenEnds("Slack"), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith([{ app: "slack_v2", mid_call: true }]);
  });

  it("edits where the summary goes", () => {
    const onChange = show({ apps: [SUMMARY] });

    fireEvent.change(screen.getByLabelText("Slack: summary goes into"), {
      target: { value: "body" },
    });

    expect(onChange).toHaveBeenCalledWith([
      { app: "slack_v2", call_ended: { ...SUMMARY.call_ended, summary_arg: "body" } },
    ]);
  });

  it("edits an argument the action needs", () => {
    const onChange = show({ apps: [SUMMARY] });

    fireEvent.change(screen.getByLabelText("Value for channel"), {
      target: { value: "#ops" },
    });

    expect(onChange).toHaveBeenCalledWith([
      {
        app: "slack_v2",
        call_ended: { ...SUMMARY.call_ended, args: { channel: "#ops" } },
      },
    ]);
  });
});

describe("what an editor is told", () => {
  it("shows what a mid-call app lets the agent do", () => {
    show({ apps: ["slack_v2"] });

    // Named without the app prefix, which is noise to a reader.
    expect(screen.getByText(/post-message, list-channels/)).toBeTruthy();
  });

  it("does not claim an end-of-call-only app gives the agent tools", () => {
    // The whole point of the split: this attachment exposes nothing to the model.
    show({ apps: [SUMMARY] });

    expect(screen.queryByText(/The agent may call/)).toBeNull();
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
  it("sees every control disabled", () => {
    show({ apps: [SUMMARY], editable: false });

    for (const box of screen.getAllByRole("checkbox")) {
      expect((box as HTMLInputElement).disabled).toBe(true);
    }
    expect((whenEnds("Slack") as HTMLSelectElement).disabled).toBe(true);
  });

  it("cannot change an attachment even if the event does not come from a browser", () => {
    const apps: AttachmentValue[] = [];
    const onChange = show({ apps, editable: false });

    fireEvent.click(duringCalls("Slack"));

    expect(onChange).not.toHaveBeenCalled();
  });
});

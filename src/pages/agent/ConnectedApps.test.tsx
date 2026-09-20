// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import {
  ConnectedApps,
  lastRun,
  pickable,
  readAttachment,
  writeAttachment,
  type AttachmentValue,
  type AutomationRun,
} from "./ConnectedApps";

afterEach(cleanup);

const CATALOG = [
  {
    app: "slack_v2",
    name: "Slack",
    tools: ["slack_v2-post-message", "slack_v2-list-channels"],
    actions: [
      {
        id: "slack_v2-post-message",
        label: "Post the call summary",
        summary_arg: "text",
        inputs: [{ name: "channel", label: "Channel", placeholder: "#sales-calls" }],
      },
    ],
  },
  {
    // No end-of-call Actions: create-event needs a start and an end, which a
    // finished call cannot supply.
    app: "google_calendar",
    name: "Google Calendar",
    tools: ["google_calendar-create-event"],
    actions: [],
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
    <MemoryRouter>
      <ConnectedApps
        apps={[]}
        catalog={CATALOG}
        connected={CONNECTED}
        editable
        onChange={onChange}
        {...props}
      />
    </MemoryRouter>,
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

  it("fills in the summary input from the catalog when an Action is picked", () => {
    const onChange = show({ apps: [] });

    fireEvent.change(whenEnds("Slack"), { target: { value: "slack_v2-post-message" } });

    expect(onChange).toHaveBeenCalledWith([
      {
        app: "slack_v2",
        call_ended: { action: "slack_v2-post-message", args: {}, summary_arg: "text" },
      },
    ]);
  });

  it("choosing 'Do nothing' clears the Automation but keeps mid-call", () => {
    const onChange = show({ apps: [{ ...SUMMARY, mid_call: true }] });

    fireEvent.change(whenEnds("Slack"), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith([{ app: "slack_v2", mid_call: true }]);
  });

  it("never asks where the summary goes — the catalog already knows", () => {
    // It is the same string for every Workspace that picks this Action. Asking
    // a person to type a constant is not configuration.
    show({ apps: [SUMMARY] });

    expect(screen.queryByLabelText(/summary goes into/i)).toBeNull();
    expect(screen.queryByText(/summary_arg/)).toBeNull();
  });

  it("asks for the action's inputs by their real names", () => {
    const onChange = show({ apps: [SUMMARY] });

    fireEvent.change(screen.getByLabelText("Slack: Channel"), { target: { value: "#ops" } });

    expect(onChange).toHaveBeenCalledWith([
      {
        app: "slack_v2",
        call_ended: { ...SUMMARY.call_ended, args: { channel: "#ops" } },
      },
    ]);
  });

  it("offers Actions by label, not by tool name", () => {
    show({ apps: [] });

    expect(screen.getByText("Post the call summary")).toBeTruthy();
    // list-channels is a mid-call tool and meaningless after a call.
    expect(screen.queryByText("list-channels")).toBeNull();
  });

  it("says so when an app has nothing worth running at the end of a call", () => {
    show({ apps: [] });

    expect(screen.getByText(/no Action that a\s+finished call has the information for/)).toBeTruthy();
    expect(screen.queryByLabelText("Google Calendar: when a call ends")).toBeNull();
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

  it("marks an attached app whose grant is gone as a fault, not a state", () => {
    // Its tools are still advertised to the model and answer nothing.
    show({ apps: ["slack_v2"], connected: [{ id: "apn_2", app: "google_calendar" }] });

    expect(screen.getByText("Disconnected").className).toMatch(/\blost\b/);
    expect(screen.getByText(/tools that will not answer/)).toBeTruthy();
  });

  it("marks a connected app connected", () => {
    show({ apps: ["slack_v2"] });

    expect(screen.getAllByText("Connected")[0].className).toMatch(/\bconnected\b/);
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
    expect((screen.getByLabelText("Slack: Channel") as HTMLInputElement).disabled).toBe(true);
  });

  it("cannot change an attachment even if the event does not come from a browser", () => {
    const apps: AttachmentValue[] = [];
    const onChange = show({ apps, editable: false });

    fireEvent.click(duringCalls("Slack"));

    expect(onChange).not.toHaveBeenCalled();
  });
});


describe("an app the builder said this agent needs", () => {
  // The builder cannot attach one (ADR-0021), so it records the requirement.
  // Before this, that record existed and nothing ever showed it to anyone.

  it("says so when the app is connected but not attached", () => {
    show({ apps: [], needs: ["google_calendar"] });

    expect(screen.getByText(/This agent needs Google Calendar/)).toBeTruthy();
    expect(screen.getByText(/available during calls/)).toBeTruthy();
  });

  it("sends you to Integrations when nobody has connected it", () => {
    show({ apps: [], needs: ["google_calendar"], connected: [] });

    expect(screen.getByText(/Nobody has connected it yet/)).toBeTruthy();
    expect(screen.getByText("connect Google Calendar").getAttribute("href")).toBe("/integrations");
  });

  it("goes quiet once the app is attached", () => {
    show({ apps: ["google_calendar"], needs: ["google_calendar"] });

    expect(screen.queryByText(/This agent needs/)).toBeNull();
  });

  it("counts an end-of-call-only attachment as met", () => {
    // Which trigger it runs on is an ordinary choice, not unfinished setup.
    show({ apps: [SUMMARY], needs: ["slack_v2"] });

    expect(screen.queryByText(/This agent needs/)).toBeNull();
  });

  it("names an app the catalog has never heard of by its slug", () => {
    show({ apps: [], needs: ["notion"] });

    expect(screen.getByText(/This agent needs notion/)).toBeTruthy();
  });
});

// What an Automation actually did (#47). ADR-0021 made it something a person
// configures here; configuring it and never hearing back is how a Slack post
// that stopped arriving reads as a quiet week.

const run = (over: Partial<AutomationRun> = {}): AutomationRun => ({
  at: "2026-09-20T09:00:00Z",
  action: "slack_v2-post-message",
  ok: true,
  reason: "ok",
  detail: "",
  ...over,
});

describe("what the automation did", () => {
  it("says it has not run yet rather than showing nothing", () => {
    // Silence is the bug this feature exists to fix; an empty list is a real
    // state and is not the same as every run having failed.
    show({ apps: [SUMMARY], runs: [] });
    expect(screen.getByText(/Hasn\u2019t run yet/)).toBeTruthy();
  });

  it("reports a refusal with what the provider said", () => {
    show({
      apps: [SUMMARY],
      runs: [run({ ok: false, reason: "refused", detail: "channel_not_found" })],
    });
    expect(screen.getByText(/Slack refused it: channel_not_found/)).toBeTruthy();
  });

  it("sends a missing grant to the person who can fix it", () => {
    // An admin connects the app; an editor cannot. Saying "failed" here would
    // point the wrong person at the wrong page.
    show({ apps: [SUMMARY], runs: [run({ ok: false, reason: "not_connected", detail: "" })] });
    expect(screen.getByText(/nobody has Slack connected/i)).toBeTruthy();
    expect(screen.getByText(/Connect it on Integrations/)).toBeTruthy();
  });

  it("distinguishes a call that could not fill a field from a failure", () => {
    show({
      apps: [SUMMARY],
      runs: [run({ ok: false, reason: "unfilled", detail: "the call cannot fill calendarId" })],
    });
    expect(screen.getByText(/Did not run — the call cannot fill calendarId/)).toBeTruthy();
  });

  it("confirms a run that worked", () => {
    show({ apps: [SUMMARY], runs: [run()] });
    expect(screen.getByText(/Ran when the last call ended/)).toBeTruthy();
  });

  it("reads the newest run for this action and ignores other actions", () => {
    const runs = [
      run({ action: "google_calendar-create-event", ok: false, reason: "error", detail: "x" }),
      run({ ok: false, reason: "refused", detail: "newest slack" }),
      run({ ok: true, reason: "ok" }),
    ];
    expect(lastRun(runs, "slack_v2-post-message")?.detail).toBe("newest slack");
  });

  it("says nothing at all when no automation is configured", () => {
    // A mid-call-only attachment has no Automation, so there is no outcome to
    // report and a "hasn't run yet" line would read as something being broken.
    show({ apps: [{ app: "slack_v2", mid_call: true }] });
    expect(screen.queryByText(/Hasn\u2019t run yet/)).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

// The Avatar on a Console test call (builder-api#124). TurnCall sends the face
// as a remote video track; the call's shared state used to drop every track
// that was not audio. Tested through the Test panel inside that shared state,
// with the Pipecat client and its transport replaced so the test fires their
// callbacks the way a real call would.

type Callbacks = {
  onBotReady?: () => void;
  onDisconnected?: () => void;
  onTrackStarted?: (track: MediaStreamTrack, participant?: { local?: boolean }) => void;
  onTrackStopped?: (track: MediaStreamTrack, participant?: { local?: boolean }) => void;
};
let callbacks: Callbacks = {};
const disconnect = vi.fn(async () => {
  callbacks.onDisconnected?.();
});

vi.mock("@pipecat-ai/client-js", () => ({
  PipecatClient: class {
    constructor(opts: { callbacks: Callbacks }) {
      callbacks = opts.callbacks;
    }
    connect = async () => {};
    disconnect = disconnect;
  },
}));
vi.mock("@pipecat-ai/small-webrtc-transport", () => ({ SmallWebRTCTransport: class {} }));
// The call's event log, as builder-api's proxy answers it: only the Avatar's
// events are ever set here, so every other read finds nothing.
let avatarEvents: { event_type: string; payload: Record<string, unknown> }[] = [];
const api = vi.fn(async (path: string) => ({
  data: path.includes("event_type=avatar.unavailable") ? avatarEvents : [],
}));
vi.mock("../../api", () => ({ api: (path: string) => api(path), getActiveWorkspaceId: () => "w1" }));
vi.mock("../../webrtc", () => ({
  buildConnectRequest: () => ({ url: "/connect" }),
  // TurnCall's answer names the call, which is what its events are read by.
  watchConnect: (_url: string, on: { call: (id: string) => void }) => {
    on.call("c1");
    return () => {};
  },
  agentStopReason: () => null,
}));
vi.mock("../../auth", () => ({ useAuth: () => ({ activeWorkspace: { role: "editor" } }) }));
vi.mock("./AgentPage", () => ({
  useAgent: () => ({ agentId: "a1", draft: undefined, data: { config: {} }, dirty: [], save: async () => true }),
}));

import TestTab from "./TestTab";
import { VoiceCallProvider } from "./VoiceCall";

// jsdom has no MediaStream, no media playback and no scrolling (the chat pane
// scrolls itself when it mounts).
Element.prototype.scrollTo = () => {};
class FakeStream {
  constructor(private tracks: MediaStreamTrack[]) {}
  getTracks() {
    return this.tracks;
  }
}
const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();
beforeEach(() => {
  vi.stubGlobal("MediaStream", FakeStream);
  HTMLMediaElement.prototype.play = play;
  HTMLMediaElement.prototype.pause = pause;
});

afterEach(() => {
  cleanup();
  callbacks = {};
  avatarEvents = [];
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const track = (kind: "audio" | "video") => ({ kind, id: `${kind}-1` }) as MediaStreamTrack;
const remote = { local: false };

// The provider sits above the panel, as on the agent page, so the panel can
// come and go while the call keeps running.
function Page() {
  const [shown, setShown] = useState(true);
  return (
    <VoiceCallProvider>
      <button onClick={() => setShown((s) => !s)}>Toggle panel</button>
      {shown && <TestTab />}
    </VoiceCallProvider>
  );
}

async function startCall() {
  render(<Page />);
  fireEvent.click(screen.getByText("Voice"));
  fireEvent.click(await screen.findByText("Start a test call"));
  await act(async () => {});
  act(() => callbacks.onBotReady?.());
}

const video = () => document.querySelector("video");
const shownTracks = () => ((video()!.srcObject as unknown) as FakeStream).getTracks();

it("shows the agent's video at the top of the Test panel", async () => {
  await startCall();
  const face = track("video");
  act(() => callbacks.onTrackStarted?.(face, remote));

  const el = video()!;
  expect(el).not.toBeNull();
  expect(shownTracks()).toEqual([face]);
  expect(el.muted).toBe(true);
  expect(el.autoplay).toBe(true);
  expect(el.hasAttribute("playsinline")).toBe(true);
  // Above the Chat|Voice toggle, so it shows in either mode.
  const toggle = screen.getByRole("group", { name: "Test mode" });
  expect(el.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("shows no video for the browser's own camera or for audio", async () => {
  await startCall();
  act(() => callbacks.onTrackStarted?.(track("video"), { local: true }));
  act(() => callbacks.onTrackStarted?.(track("audio"), remote));

  expect(video()).toBeNull();
  // The agent's voice still plays, on its own element.
  expect(play).toHaveBeenCalledTimes(1);
});

it("removes the video when the agent ends the call", async () => {
  await startCall();
  act(() => callbacks.onTrackStarted?.(track("video"), remote));
  act(() => callbacks.onDisconnected?.());
  expect(video()).toBeNull();
});

it("removes the video when you end the call", async () => {
  await startCall();
  act(() => callbacks.onTrackStarted?.(track("video"), remote));
  await act(async () => fireEvent.click(screen.getByText("End call")));
  expect(video()).toBeNull();
});

it("shows the video again when you come back to the Test panel mid-call", async () => {
  await startCall();
  const face = track("video");
  act(() => {
    callbacks.onTrackStarted?.(track("audio"), remote);
    callbacks.onTrackStarted?.(face, remote);
  });

  fireEvent.click(screen.getByText("Toggle panel"));
  expect(video()).toBeNull();
  fireEvent.click(screen.getByText("Toggle panel"));

  expect(shownTracks()).toEqual([face]);
  // The call — and its voice — carried on while the panel was away.
  expect(disconnect).not.toHaveBeenCalled();
  expect(pause).not.toHaveBeenCalled();
  expect(play).toHaveBeenCalledTimes(1);
});

// SmallWebRTC reports a remote track muting or ending as onTrackStopped(track)
// and its return as onTrackStarted(track) — no participant on either — so a
// dropped Avatar must not leave its last frame frozen on the panel.
it("removes the video while the agent's video track is stopped, and shows it again when it resumes", async () => {
  await startCall();
  const face = track("video");
  const voice = track("audio");
  act(() => {
    callbacks.onTrackStarted?.(voice);
    callbacks.onTrackStarted?.(face);
  });
  expect(shownTracks()).toEqual([face]);

  act(() => callbacks.onTrackStopped?.(voice));
  expect(shownTracks()).toEqual([face]); // only the video's own stop removes it

  act(() => callbacks.onTrackStopped?.(face));
  expect(video()).toBeNull();
  // The call and its voice carry on without the face.
  expect(screen.getByText("End call")).toBeTruthy();
  expect(disconnect).not.toHaveBeenCalled();
  expect(pause).not.toHaveBeenCalled();

  act(() => callbacks.onTrackStarted?.(face));
  expect(shownTracks()).toEqual([face]);
});

// Why the face is missing (#121). TurnCall records `avatar.unavailable`
// {provider, reason} on the call's event log; the panel reads it a few seconds
// after the call is up, when the agent's video stops mid-call, and when the
// call ends.
const unavailable = (provider: string, reason: string) => [
  { event_type: "avatar.unavailable", payload: { provider, reason } },
];

// Fake timers only once the call is being placed: the panel's lazy Voice tab
// is found with real ones.
async function startTimedCall() {
  render(<Page />);
  fireEvent.click(screen.getByText("Voice"));
  fireEvent.click(await screen.findByText("Start a test call"));
  vi.useFakeTimers();
  await act(async () => {});
  act(() => callbacks.onBotReady?.());
}
const settle = () => act(async () => vi.advanceTimersByTimeAsync(10_000));

it("says why there is no Avatar once the call is up", async () => {
  avatarEvents = unavailable("heygen", "session_refused");
  await startTimedCall();
  expect(screen.queryByText(/No Avatar on this call/)).toBeNull();

  await settle();

  expect(api).toHaveBeenCalledWith("/agents/a1/calls/c1/events?event_type=avatar.unavailable");
  expect(screen.getByText("No Avatar on this call — HeyGen refused or couldn't start the session.")).toBeTruthy();
  // Where the face would be: above the Chat|Voice toggle.
  const note = screen.getByText(/No Avatar on this call/);
  const toggle = screen.getByRole("group", { name: "Test mode" });
  expect(note.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("says the Avatar stopped while the call is still up, when its session ends mid-call", async () => {
  await startTimedCall();
  const face = track("video");
  act(() => callbacks.onTrackStarted?.(face));
  await settle(); // nothing recorded yet: the face is up

  // The sandbox's cutoff: TurnCall records it, and the face drops.
  avatarEvents = unavailable("heygen", "session_ended");
  act(() => callbacks.onTrackStopped?.(face));
  await settle();

  expect(
    screen.getByText("The Avatar stopped — the HeyGen session ended (a sandbox session lasts about a minute)."),
  ).toBeTruthy();
  expect(screen.getByText("End call")).toBeTruthy();
  expect(disconnect).not.toHaveBeenCalled();
});

it("reads why again when the call ends", async () => {
  await startTimedCall();
  await settle(); // nothing recorded yet

  avatarEvents = unavailable("tavus", "session_refused");
  act(() => callbacks.onDisconnected?.());
  await settle();

  expect(screen.getByText("No Avatar on this call — Tavus refused or couldn't start the session.")).toBeTruthy();
});

it("shows no such line for an Agent without an Avatar, or an Avatar that runs", async () => {
  await startTimedCall();
  act(() => callbacks.onTrackStarted?.(track("video"), remote));
  await settle();
  await act(async () => fireEvent.click(screen.getByText("End call")));
  await settle();

  expect(api).toHaveBeenCalledWith("/agents/a1/calls/c1/events?event_type=avatar.unavailable");
  expect(screen.queryByText(/Avatar/)).toBeNull();
});

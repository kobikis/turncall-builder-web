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
vi.mock("../../api", () => ({ api: vi.fn(async () => ({ data: [] })), getActiveWorkspaceId: () => "w1" }));
vi.mock("../../webrtc", () => ({
  buildConnectRequest: () => ({ url: "/connect" }),
  watchConnect: () => () => {},
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

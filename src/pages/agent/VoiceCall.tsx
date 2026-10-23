import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { api, getActiveWorkspaceId } from "../../api";
import { agentStopReason, avatarUnavailableReason, buildConnectRequest, watchConnect } from "../../webrtc";

// The WebRTC test call lives here (provided at the agent level) rather than in
// the Voice tab, so switching tabs — or the Chat/Voice toggle — doesn't tear the
// call down. It ends only on explicit stop or when you leave the agent (the
// provider is keyed by agent id in AgentPage, so it remounts per agent).

export type CallState = "idle" | "connecting" | "connected" | "error";

type Ctx = {
  state: CallState;
  msg: string;
  start: (agentId: string, variables?: Record<string, string>) => Promise<void>;
  stop: () => Promise<void>;
  // The remote video track — an Avatar's face — while the call carries one.
  video: MediaStreamTrack | null;
  // Why an Agent's Avatar is not showing, as TurnCall recorded it; null when
  // nothing was recorded (no Avatar, or one that runs).
  avatarNote: string | null;
};

const VoiceCallCtx = createContext<Ctx | null>(null);

export function useVoiceCall(): Ctx {
  const c = useContext(VoiceCallCtx);
  if (!c) throw new Error("useVoiceCall must be used within <VoiceCallProvider>");
  return c;
}

// Guard against a signaling failure (bad offer / proxy 4xx-5xx / unreachable)
// showing up as a plain "Call ended". The transport silently retries then
// disconnects on a non-OK signaling response, so we bound the connect with a
// timer and mark failures so onDisconnected doesn't overwrite the reason.
const CONNECT_TIMEOUT_MS = 15000;

// How often to ask, while the call is up, why its Avatar is not showing.
// TurnCall records a refused session while it starts, which can outlast the
// pipeline's own start by seconds, and one that ended mid-call only after the
// face has been gone 5 s; the browser may report the track stopping before
// that, or never. Asked until a reason is found or the call ends.
const AVATAR_POLL_MS = 8000;

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CallState>("idle");
  const [msg, setMsg] = useState("");
  const [video, setVideo] = useState<MediaStreamTrack | null>(null);
  const [avatarNote, setAvatarNote] = useState<string | null>(null);
  const avatarPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // TurnCall gave this call's reason: its Avatar is gone for good.
  const avatarGoneRef = useRef(false);
  // Which call a read belongs to, so one that answers late can't label the next.
  const callSeqRef = useRef(0);
  const clientRef = useRef<{ disconnect: () => Promise<void> } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const erroredRef = useRef(false);
  const unwatchRef = useRef<(() => void) | null>(null);
  const callIdRef = useRef<string | null>(null);
  // The agent's voice: one element per call. The transport reports the audio
  // track again each time it resumes after a stall, and a new element each
  // time played the same voice over itself (#123).
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  // The signaling watch outlives a failure on purpose: it is what keeps the
  // transport's retries off the server. It ends when the call connects, when
  // the user stops, when the next call starts, or when the page goes.
  const unwatch = () => {
    unwatchRef.current?.();
    unwatchRef.current = null;
  };

  const releaseAudio = () => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (!audio) return;
    audio.pause();
    audio.srcObject = null;
  };

  const stopAvatarPoll = () => {
    if (avatarPollRef.current) clearInterval(avatarPollRef.current);
    avatarPollRef.current = null;
  };

  // Tear down only when the provider unmounts (leaving the agent).
  useEffect(
    () => () => {
      clearTimer();
      stopAvatarPoll();
      unwatch();
      releaseAudio();
      void clientRef.current?.disconnect().catch(() => {});
    },
    [],
  );

  function fail(message: string) {
    erroredRef.current = true;
    clearTimer();
    stopAvatarPoll();
    setState("error");
    setMsg(message);
    setVideo(null);
    releaseAudio();
    void clientRef.current?.disconnect().catch(() => {});
    clientRef.current = null;
  }

  async function start(agentId: string, variables: Record<string, string> = {}) {
    if (clientRef.current) return; // a call is already up
    // The proxy is Workspace-scoped; without an active Workspace it would 4xx and
    // the transport would silently retry into a confusing "Call ended".
    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) {
      fail("No workspace selected — reload and try again.");
      return;
    }
    erroredRef.current = false;
    callSeqRef.current += 1;
    stopAvatarPoll();
    avatarGoneRef.current = false;
    setAvatarNote(null);
    setState("connecting");
    setMsg("Requesting mic + connecting…");
    // Signaling failures don't reject connect() (the transport retries then
    // disconnects), so surface a real message if the call never comes up.
    clearTimer();
    timerRef.current = setTimeout(
      () => fail("Couldn't reach the voice server — the agent may be unavailable."),
      CONNECT_TIMEOUT_MS,
    );
    try {
      // Pipecat's WebRTC client is heavy — load it only when a call actually starts.
      const [{ PipecatClient }, { SmallWebRTCTransport }] = await Promise.all([
        import("@pipecat-ai/client-js"),
        import("@pipecat-ai/small-webrtc-transport"),
      ]);
      const transport = new SmallWebRTCTransport({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        // Bundle ICE candidates into the offer SDP so the whole exchange is one
        // POST — builder-api's proxy (#35) handles offer→answer only, not the
        // trickle-ICE PATCH the transport would otherwise send.
        waitForICEGathering: true,
      });
      const client = new PipecatClient({
        transport,
        enableMic: true,
        enableCam: false,
        callbacks: {
          onConnected: () => {
            clearTimer();
            unwatch();
            setState("connected");
          },
          onBotReady: () => {
            clearTimer();
            unwatch();
            setState("connected");
            setMsg("Connected — speak now.");
            stopAvatarPoll();
            avatarPollRef.current = setInterval(() => {
              const callId = callIdRef.current;
              if (callId) void explainAvatar(agentId, callId);
            }, AVATAR_POLL_MS);
          },
          onDisconnected: () => {
            clientRef.current = null;
            clearTimer();
            stopAvatarPoll();
            setVideo(null);
            releaseAudio();
            if (erroredRef.current) return; // keep the failure reason
            setState("idle");
            setMsg("Call ended.");
            // A call the agent ended on a provider error looks like any other
            // hangup from here; TurnCall recorded why before the line dropped.
            const callId = callIdRef.current;
            callIdRef.current = null;
            if (callId) {
              void explainEnd(agentId, callId);
              void explainAvatar(agentId, callId);
            }
          },
          onTransportStateChanged: (s: string) => {
            if (s === "error") fail("Connection error.");
          },
          onTrackStarted: (track: MediaStreamTrack, participant?: { local?: boolean }) => {
            if (participant?.local) return;
            // An Avatar's face. Kept in state rather than attached here: the
            // Test panel shows it, and can unmount and remount mid-call. Not
            // once TurnCall said the Avatar is gone: nothing switches back.
            if (track.kind === "video") {
              if (!avatarGoneRef.current) setVideo(track);
              return;
            }
            if (track.kind !== "audio") return;
            const audio = (audioRef.current ??= new Audio());
            audio.srcObject = new MediaStream([track]);
            audio.play().catch(() => {});
          },
          // A muted or ended track (no participant on SmallWebRTC's call): an
          // Avatar that drops would otherwise leave its last frame frozen. It
          // comes back through onTrackStarted when the track resumes.
          onTrackStopped: (track: MediaStreamTrack, participant?: { local?: boolean }) => {
            if (participant?.local) return;
            setVideo((held) => (held === track ? null : held));
          },
        },
      });
      clientRef.current = client;
      const endpoint = buildConnectRequest(agentId, workspaceId, variables);
      // A refused connect carries the reason (e.g. a provider with no key);
      // fail() also disconnects, which stops the transport's retries.
      callIdRef.current = null;
      unwatch();
      unwatchRef.current = watchConnect(endpoint.url, {
        failure: fail,
        call: (callId) => {
          callIdRef.current = callId;
        },
      });
      await client.connect({
        webrtcRequestParams: {
          // Signaling goes through builder-api's proxy (#35) — the session cookie
          // + X-Workspace-Id (baked into this Request) authenticate it; no
          // TurnCall key is ever fetched or sent. The agent is pinned by the path.
          endpoint,
        },
      });
    } catch (e) {
      fail(e instanceof Error ? e.message : "Couldn't start the call.");
    }
  }

  async function explainEnd(agentId: string, callId: string) {
    try {
      const r = await api(`/agents/${agentId}/calls/${callId}/events?event_type=error.raised`);
      const reason = agentStopReason(r.data || []);
      if (reason) fail(reason);
    } catch {
      /* the plain "Call ended." stands */
    }
  }

  // Read every AVATAR_POLL_MS while the call is up, and once when it ends. A
  // reason found is final: the face goes (its track may never say so), and
  // the asking stops.
  async function explainAvatar(agentId: string, callId: string) {
    const seq = callSeqRef.current;
    try {
      const r = await api(`/agents/${agentId}/calls/${callId}/events?event_type=avatar.unavailable`);
      const note = avatarUnavailableReason(r.data || []);
      if (!note || seq !== callSeqRef.current) return;
      stopAvatarPoll();
      avatarGoneRef.current = true;
      setVideo(null);
      setAvatarNote(note);
    } catch {
      /* no reason to show; the panel just has no face */
    }
  }

  async function stop() {
    clearTimer();
    stopAvatarPoll();
    unwatch();
    erroredRef.current = false;
    try {
      await clientRef.current?.disconnect();
    } catch {
      /* already gone */
    }
    clientRef.current = null;
    setState("idle");
    setMsg("Call ended.");
    setVideo(null);
    releaseAudio();
  }

  return (
    <VoiceCallCtx.Provider value={{ state, msg, start, stop, video, avatarNote }}>
      {children}
    </VoiceCallCtx.Provider>
  );
}

// The call's video, while there is one. Muted because the audio has its own
// element, which plays whether or not this is mounted. Renders nothing outside
// a provider, so the Test panel needs no call to render.
export function CallVideo() {
  const ctx = useContext(VoiceCallCtx);
  const track = ctx?.video ?? null;
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && track) ref.current.srcObject = new MediaStream([track]);
  }, [track]);
  // Where the face would be: why it isn't there, when TurnCall said.
  if (!track) return ctx?.avatarNote ? <p className="muted call-avatar-note">{ctx.avatarNote}</p> : null;
  return <video ref={ref} className="call-video" autoPlay playsInline muted />;
}

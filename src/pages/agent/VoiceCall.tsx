import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { getActiveWorkspaceId } from "../../api";
import { buildConnectRequest } from "../../webrtc";

// The WebRTC test call lives here (provided at the agent level) rather than in
// the Voice tab, so switching tabs — or the Chat/Voice toggle — doesn't tear the
// call down. It ends only on explicit stop or when you leave the agent (the
// provider is keyed by agent id in AgentPage, so it remounts per agent).

export type CallState = "idle" | "connecting" | "connected" | "error";

type Ctx = {
  state: CallState;
  msg: string;
  start: (agentId: string) => Promise<void>;
  stop: () => Promise<void>;
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

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CallState>("idle");
  const [msg, setMsg] = useState("");
  const clientRef = useRef<{ disconnect: () => Promise<void> } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const erroredRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  // Tear down only when the provider unmounts (leaving the agent).
  useEffect(
    () => () => {
      clearTimer();
      void clientRef.current?.disconnect().catch(() => {});
    },
    [],
  );

  function fail(message: string) {
    erroredRef.current = true;
    clearTimer();
    setState("error");
    setMsg(message);
    void clientRef.current?.disconnect().catch(() => {});
    clientRef.current = null;
  }

  async function start(agentId: string) {
    if (clientRef.current) return; // a call is already up
    // The proxy is Workspace-scoped; without an active Workspace it would 4xx and
    // the transport would silently retry into a confusing "Call ended".
    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) {
      fail("No workspace selected — reload and try again.");
      return;
    }
    erroredRef.current = false;
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
            setState("connected");
          },
          onBotReady: () => {
            clearTimer();
            setState("connected");
            setMsg("Connected — speak now.");
          },
          onDisconnected: () => {
            clientRef.current = null;
            clearTimer();
            if (erroredRef.current) return; // keep the failure reason
            setState("idle");
            setMsg("Call ended.");
          },
          onTransportStateChanged: (s: string) => {
            if (s === "error") fail("Connection error.");
          },
          onTrackStarted: (track: MediaStreamTrack, participant?: { local?: boolean }) => {
            if (participant?.local || track.kind !== "audio") return;
            const audio = new Audio();
            audio.srcObject = new MediaStream([track]);
            audio.play().catch(() => {});
          },
        },
      });
      clientRef.current = client;
      await client.connect({
        webrtcRequestParams: {
          // Signaling goes through builder-api's proxy (#35) — the session cookie
          // + X-Workspace-Id (baked into this Request) authenticate it; no
          // TurnCall key is ever fetched or sent. The agent is pinned by the path.
          endpoint: buildConnectRequest(agentId, workspaceId),
        },
      });
    } catch (e) {
      fail(e instanceof Error ? e.message : "Couldn't start the call.");
    }
  }

  async function stop() {
    clearTimer();
    erroredRef.current = false;
    try {
      await clientRef.current?.disconnect();
    } catch {
      /* already gone */
    }
    clientRef.current = null;
    setState("idle");
    setMsg("Call ended.");
  }

  return <VoiceCallCtx.Provider value={{ state, msg, start, stop }}>{children}</VoiceCallCtx.Provider>;
}

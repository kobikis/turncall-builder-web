import { displayName } from "./pages/integrations/ProviderAccounts";
// Build the signaling request for a WebRTC test call (#29). The browser POSTs its
// SDP offer to builder-api's proxy (#35) — NOT TurnCall directly — so no TurnCall
// key ever reaches the browser. Returned as a Request so the SmallWebRTC transport
// preserves credentials + headers through its own fetch: same-origin sends the
// session cookie, and X-Workspace-Id scopes it to the active Workspace (the proxy
// is editor-gated). The agent is pinned by the path; the proxy strips any routing
// the client might add.
export function buildConnectRequest(agentId: string, workspaceId: string | null): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
  // Resolve against the page origin (same as a relative URL in the browser, but
  // explicit so it's a valid absolute URL everywhere it's constructed).
  const url = new URL(
    `/api/agents/${encodeURIComponent(agentId)}/webrtc/connect`,
    window.location.origin,
  );
  return new Request(url, { method: "POST", credentials: "same-origin", headers });
}

// The WebRTC transport swallows a failed signaling response — it logs at debug
// and retries — so the reason the proxy gave never reached the page, and a call
// that could not start just timed out. Watch the offer (the POST to the connect
// URL) for the length of the handshake: hand over the reason when it is refused,
// and the call id when it is answered. Only the POST — the transport also
// PATCHes ICE candidates there, which the proxy answers 405 by design.
//
// Once an offer is refused, later offers are answered here without reaching the
// network. The transport retries a refused offer on a timer that disconnecting
// does not cancel (and `stop()` resets its attempt count), so one press of
// "Test call" used to place four failed calls. Returns the function that stops
// watching — and blocking.
export function watchConnect(
  url: string,
  on: { failure: (reason: string) => void; call: (callId: string) => void },
): () => void {
  const original = window.fetch;
  let refused = false;
  window.fetch = async (input, init) => {
    const req = input instanceof Request ? input : null;
    const target = req ? req.url : String(input);
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    const isOffer = target === url && method === "POST";
    if (isOffer && refused) {
      return new Response(JSON.stringify({ detail: "already refused" }), { status: 409 });
    }
    const res = await original.call(window, input, init);
    if (isOffer) {
      if (!res.ok) {
        refused = true;
        on.failure(await failureReason(res.clone()));
      } else {
        const callId = await answeredCallId(res.clone());
        if (callId) on.call(callId);
      }
    }
    return res;
  };
  return () => {
    window.fetch = original;
  };
}

// "Deepgram", "Deepgram and OpenAI", "Deepgram, OpenAI and Cartesia".
function keyNames(accounts: string[]): string {
  const names = accounts.map(displayName);
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const missingKeysMessage = (accounts: string[]) =>
  `No ${keyNames(accounts)} API key — add ${accounts.length > 1 ? "them" : "one"} in Integrations.`;

async function failureReason(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const missing = body?.missing_keys;
    if (Array.isArray(missing) && missing.length) return missingKeysMessage(missing);
    if (typeof body?.detail === "string" && body.detail) return body.detail;
  } catch {
    /* not JSON */
  }
  return `The voice server refused the call (HTTP ${res.status}).`;
}

async function answeredCallId(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    return typeof body?.call_id === "string" ? body.call_id : null;
  } catch {
    return null;
  }
}

// Why the agent ended a call it had started: a provider that stopped working
// mid-call (a 401 from a speech provider with no key, say). TurnCall records it
// as an `error.raised` event before the line drops; null when there is none.
type ErrorPayload = {
  error?: unknown;
  provider?: unknown;
  key_rejected?: unknown;
  missing_keys?: unknown;
};

export function agentStopReason(events: { payload?: ErrorPayload }[]): string | null {
  const p = events.find((e) => typeof e.payload?.error === "string")?.payload;
  if (!p) return null;
  if (Array.isArray(p.missing_keys) && p.missing_keys.length) {
    return missingKeysMessage(p.missing_keys.map(String));
  }
  if (p.key_rejected === true && typeof p.provider === "string") {
    return `The ${displayName(p.provider)} API key was rejected — check it in Integrations.`;
  }
  return p.error ? `The agent stopped: ${p.error}` : null;
}

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
// that could not start just timed out. Watch the connect URL for the length of
// the handshake and hand the reason over. Returns the function that stops it.
export function watchConnectFailures(
  url: string,
  onFailure: (reason: string) => void,
): () => void {
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const res = await original.call(window, input, init);
    const target = input instanceof Request ? input.url : String(input);
    if (!res.ok && target === url) onFailure(await failureReason(res.clone()));
    return res;
  };
  return () => {
    window.fetch = original;
  };
}

async function failureReason(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string" && body.detail) return body.detail;
  } catch {
    /* not JSON */
  }
  return `The voice server refused the call (HTTP ${res.status}).`;
}

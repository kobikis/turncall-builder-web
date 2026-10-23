// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentStopReason, avatarUnavailableReason, buildConnectRequest, watchConnect } from "./webrtc";

// The security contract of #29: the WebRTC test call is signaled through the
// builder proxy with the session cookie, scoped by X-Workspace-Id, and NEVER
// carries a TurnCall key. (jsdom env: a relative URL needs a document origin.)

describe("buildConnectRequest", () => {
  it("targets the builder proxy path with POST + same-origin cookie", () => {
    const r = buildConnectRequest("a1", "ws1");
    expect(new URL(r.url).pathname).toBe("/api/agents/a1/webrtc/connect");
    expect(r.method).toBe("POST");
    expect(r.credentials).toBe("same-origin"); // sends the httpOnly session cookie
  });

  it("scopes to the active workspace and carries no key", () => {
    const r = buildConnectRequest("a1", "ws1");
    expect(r.headers.get("X-Workspace-Id")).toBe("ws1");
    expect(r.headers.get("Authorization")).toBeNull(); // browser holds no TurnCall key
  });

  it("omits the workspace header when none is active", () => {
    const r = buildConnectRequest("a1", null);
    expect(r.headers.get("X-Workspace-Id")).toBeNull();
  });

  it("carries a test call's variables as URL-encoded JSON", () => {
    // The transport replaces the Request's body with the SDP, so a header is
    // the one way through; a header is ASCII and an address may not be.
    const r = buildConnectRequest("a1", "ws1", { address: "רחוב הרצל 12" });
    const header = r.headers.get("X-Call-Variables")!;
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(decodeURIComponent(header))).toEqual({ address: "רחוב הרצל 12" });
  });

  it("sends no variables header when there are none", () => {
    expect(buildConnectRequest("a1", "ws1").headers.get("X-Call-Variables")).toBeNull();
    expect(buildConnectRequest("a1", "ws1", {}).headers.get("X-Call-Variables")).toBeNull();
  });

  it("encodes the agent id into the path", () => {
    const r = buildConnectRequest("a/b", null);
    expect(new URL(r.url).pathname).toBe("/api/agents/a%2Fb/webrtc/connect");
  });
});

describe("watchConnect", () => {
  const url = "http://localhost/api/agents/a1/webrtc/connect";
  const realFetch = window.fetch;
  afterEach(() => {
    window.fetch = realFetch;
  });

  function respond(status: number, body: unknown) {
    window.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  }
  const post = () => window.fetch(new Request(url, { method: "POST" }));
  const handlers = () => ({ failure: vi.fn(), call: vi.fn() });

  it("hands over the proxy's reason when the offer is refused", async () => {
    respond(502, { detail: "The agent could not start: Missing credentials" });
    const on = handlers();
    const stop = watchConnect(url, on);
    await post();
    stop();
    expect(on.failure).toHaveBeenCalledWith("The agent could not start: Missing credentials");
  });

  it("names the keys the proxy says are missing", async () => {
    respond(502, { detail: "long upstream sentence", missing_keys: ["deepgram"] });
    const on = handlers();
    watchConnect(url, on);
    await post();
    expect(on.failure).toHaveBeenCalledWith("No Deepgram API key — add one in Integrations.");
  });

  it("falls back to the status when the body says nothing", async () => {
    window.fetch = vi.fn(async () => new Response("oops", { status: 500 }));
    const on = handlers();
    watchConnect(url, on);
    await post();
    expect(on.failure).toHaveBeenCalledWith("The voice server refused the call (HTTP 500).");
  });

  it("hands over the call id when the offer is answered", async () => {
    respond(200, { sdp: "v=0", type: "answer", call_id: "c1" });
    const on = handlers();
    watchConnect(url, on);
    await post();
    expect(on.call).toHaveBeenCalledWith("c1");
    expect(on.failure).not.toHaveBeenCalled();
  });

  it("keeps the transport's retries of a refused offer off the network", async () => {
    respond(502, { detail: "No key" });
    const network = window.fetch;
    const on = handlers();
    watchConnect(url, on);
    await post();
    const retry = await post();
    expect(retry.status).toBe(409);
    expect(network).toHaveBeenCalledTimes(1);
    expect(on.failure).toHaveBeenCalledTimes(1);
  });

  it("ignores the ICE PATCH the proxy refuses by design, and other URLs", async () => {
    respond(405, { detail: "Method Not Allowed" });
    const on = handlers();
    watchConnect(url, on);
    await window.fetch(new Request(url, { method: "PATCH" }));
    await window.fetch(new Request("http://localhost/api/other", { method: "POST" }));
    expect(on.failure).not.toHaveBeenCalled();
  });

  it("puts fetch back when stopped", () => {
    const before = window.fetch;
    const stop = watchConnect(url, handlers());
    expect(window.fetch).not.toBe(before);
    stop();
    expect(window.fetch).toBe(before);
  });
});

describe("agentStopReason", () => {
  it("names the provider error the agent stopped on", () => {
    const events = [{ payload: { stage: "DeepgramSTTService#0", error: "status 401" } }];
    expect(agentStopReason(events)).toBe("The agent stopped: status 401");
  });

  it("names a rejected key by its provider", () => {
    const events = [{ payload: { error: "x", provider: "deepgram", key_rejected: true } }];
    expect(agentStopReason(events)).toBe(
      "The Deepgram API key was rejected — check it in Integrations.",
    );
  });

  it("names missing keys", () => {
    const events = [{ payload: { error: "x", missing_keys: ["deepgram", "openai"] } }];
    expect(agentStopReason(events)).toBe(
      "No Deepgram and OpenAI API key — add them in Integrations.",
    );
  });

  it("is null for a call nothing went wrong on", () => {
    expect(agentStopReason([])).toBeNull();
  });
});

describe("avatarUnavailableReason", () => {
  const reason = (provider: string, reason: string) =>
    avatarUnavailableReason([{ payload: { provider, reason } }]);

  it("names the ID the Avatar section asks for", () => {
    expect(reason("tavus", "missing_id")).toBe("No Avatar on this call — the Agent has no Replica ID set.");
    expect(reason("heygen", "missing_id")).toBe("No Avatar on this call — the Agent has no Avatar ID set.");
  });

  // An inline Agent from call-init is not held to the API's provider list
  // (kobikis/turncall#402 records it as unknown_provider).
  it("says when TurnCall has no Avatar from the provider named", () => {
    expect(reason("d-id", "unknown_provider")).toBe("No Avatar on this call — TurnCall has no Avatar from D-id.");
  });

  it("is null with nothing recorded", () => {
    expect(avatarUnavailableReason([])).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentStopReason, buildConnectRequest, watchConnect } from "./webrtc";

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

  it("is null for a call nothing went wrong on", () => {
    expect(agentStopReason([])).toBeNull();
  });
});

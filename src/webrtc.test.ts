// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConnectRequest, watchConnectFailures } from "./webrtc";

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

describe("watchConnectFailures", () => {
  const url = "http://localhost/api/agents/a1/webrtc/connect";
  const realFetch = window.fetch;
  afterEach(() => {
    window.fetch = realFetch;
  });

  function respond(status: number, body: unknown) {
    window.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  }

  it("hands over the proxy's reason when the connect fails", async () => {
    respond(502, { detail: "The agent could not start: Missing credentials" });
    const onFailure = vi.fn();
    const stop = watchConnectFailures(url, onFailure);
    await window.fetch(new Request(url, { method: "POST" }));
    stop();
    expect(onFailure).toHaveBeenCalledWith("The agent could not start: Missing credentials");
  });

  it("falls back to the status when the body says nothing", async () => {
    window.fetch = vi.fn(async () => new Response("oops", { status: 500 }));
    const onFailure = vi.fn();
    watchConnectFailures(url, onFailure);
    await window.fetch(url);
    expect(onFailure).toHaveBeenCalledWith("The voice server refused the call (HTTP 500).");
  });

  it("ignores other URLs and successful answers", async () => {
    respond(500, { detail: "x" });
    const onFailure = vi.fn();
    watchConnectFailures(url, onFailure);
    await window.fetch("http://localhost/api/other");
    respond(200, { sdp: "v=0" });
    watchConnectFailures(url, onFailure);
    await window.fetch(url);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("puts fetch back when stopped", () => {
    const before = window.fetch;
    const stop = watchConnectFailures(url, vi.fn());
    expect(window.fetch).not.toBe(before);
    stop();
    expect(window.fetch).toBe(before);
  });
});

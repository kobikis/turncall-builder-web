// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildConnectRequest } from "./webrtc";

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

import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, setActiveWorkspaceId } from "./api";

// The one security-relevant seam in #27: every builder request must carry the
// active X-Workspace-Id (so the backend RBAC gate scopes it) and the session
// cookie (same-origin). A silent regression here would leak across tenants or
// log everyone out, so it's the piece worth a test in an otherwise UI ticket.

type FetchInit = { headers: Record<string, string>; credentials?: string };

function stubFetch(response?: { ok?: boolean; status?: number; body?: unknown }) {
  // Typed params so fetchMock.mock.calls is [string, FetchInit], not [].
  const fn = vi.fn(async (_url: string, _init: FetchInit) => ({
    ok: response?.ok ?? true,
    status: response?.status ?? 200,
    json: async () => response?.body ?? { success: true, data: {} },
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  setActiveWorkspaceId(null);
  vi.unstubAllGlobals();
});

describe("api()", () => {
  it("attaches the active X-Workspace-Id header", async () => {
    const fetchMock = stubFetch();
    setActiveWorkspaceId("ws-1");
    await api("/agents");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-Workspace-Id"]).toBe("ws-1");
  });

  it("omits the workspace header when none is active", async () => {
    const fetchMock = stubFetch();
    await api("/auth/me"); // pre-login / login-gated call: no workspace yet
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-Workspace-Id"]).toBeUndefined();
  });

  it("prefixes /api and sends the session cookie same-origin", async () => {
    const fetchMock = stubFetch();
    await api("/workspaces");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workspaces");
    expect(init.credentials).toBe("same-origin");
  });

  it("throws ApiError with the server detail on non-2xx", async () => {
    stubFetch({ ok: false, status: 403, body: { detail: "requires editor role" } });
    await expect(api("/agents")).rejects.toMatchObject({
      status: 403,
      message: "requires editor role",
    });
    await expect(api("/agents")).rejects.toBeInstanceOf(ApiError);
  });

  it("turns a network failure into ApiError status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    await expect(api("/agents")).rejects.toMatchObject({ status: 0 });
  });

  it("lets a caller override default headers", async () => {
    const fetchMock = stubFetch();
    await api("/agents", { headers: { "X-Workspace-Id": "explicit" } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-Workspace-Id"]).toBe("explicit");
  });

  it("omits Content-Type for FormData bodies (browser sets the boundary)", async () => {
    const fetchMock = stubFetch();
    await api("/knowledge-bases/kb/documents", {
      method: "POST",
      body: new FormData(),
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBeUndefined();
  });
});

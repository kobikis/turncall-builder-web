// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth";
import { RequireAuth, ResumePendingInvite } from "./App";
import { stashPendingInvite, takePendingInvite } from "./pendingInvite";

// Proves both halves of the fix: RequireAuth stashes the invite path when an
// unauthenticated user hits it, and ResumePendingInvite navigates there once the
// user is authenticated (so a link clicked while logged out isn't lost).

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function mockAuthed() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith("/workspaces")
          ? { data: { workspaces: [{ id: "w1", name: "W", role: "admin" }] } }
          : { data: { user: { id: "u1", email: "u@x" } } },
    })),
  );
}

function mockUnauthed() {
  // /auth/me → 401 so AuthProvider settles with no user.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ detail: "no" }) })),
  );
}

describe("ResumePendingInvite", () => {
  it("navigates to a stashed invite once authenticated", async () => {
    mockAuthed();
    stashPendingInvite("/invite?token=abc");
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/agents"]}>
          <ResumePendingInvite />
          <Routes>
            <Route path="/agents" element={<div>AGENTS</div>} />
            <Route path="/invite" element={<div>INVITE PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
    expect(await screen.findByText("INVITE PAGE")).toBeTruthy();
  });

  it("RequireAuth stashes the invite path then redirects an unauth user to login", async () => {
    mockUnauthed();
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/invite?token=abc"]}>
          <Routes>
            <Route
              path="/invite"
              element={
                <RequireAuth>
                  <div>INVITE PAGE</div>
                </RequireAuth>
              }
            />
            <Route path="/login" element={<div>LOGIN</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
    expect(await screen.findByText("LOGIN")).toBeTruthy();
    expect(takePendingInvite()).toBe("/invite?token=abc");
  });

  it("stays put when nothing is stashed", async () => {
    mockAuthed();
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/agents"]}>
          <ResumePendingInvite />
          <Routes>
            <Route path="/agents" element={<div>AGENTS</div>} />
            <Route path="/invite" element={<div>INVITE PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
    expect(await screen.findByText("AGENTS")).toBeTruthy();
    expect(screen.queryByText("INVITE PAGE")).toBeNull();
  });
});

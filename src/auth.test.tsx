// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, chooseActive } from "./auth";
import { RequireRole } from "./App";
import type { Role, Workspace } from "./types";

// chooseActive is the workspace-selection logic behind bootstrap + invite-accept
// (a stale pick here silently strands a user on the wrong tenant). RequireRole is
// the client mirror of the server's admin/editor gate.

const ws = (id: string, role: Role = "admin"): Workspace => ({ id, name: id, role });

afterEach(() => {
  cleanup(); // no vitest globals, so unmount previous renders explicitly
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("chooseActive", () => {
  it("returns null when there are no workspaces", () => {
    expect(chooseActive([])).toBeNull();
  });

  it("prefers the last-used workspace when it is still a membership", () => {
    localStorage.setItem("tc.activeWorkspaceId", "w2");
    expect(chooseActive([ws("w1"), ws("w2")])).toBe("w2");
  });

  it("falls back to the first when the stored id is no longer a membership", () => {
    localStorage.setItem("tc.activeWorkspaceId", "gone");
    expect(chooseActive([ws("w1"), ws("w2")])).toBe("w1");
  });
});

// Mock the two bootstrap calls AuthProvider makes so it settles on a known role.
function mockAuthAs(role: Role) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith("/workspaces")
          ? { data: { workspaces: [ws("w1", role)] } }
          : { data: { user: { id: "u1", email: "u@x" } } },
    })),
  );
}

function renderGated(min: Role) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/secret"]}>
        <Routes>
          <Route
            path="/secret"
            element={
              <RequireRole min={min}>
                <div>SECRET</div>
              </RequireRole>
            }
          />
          <Route path="/agents" element={<div>AGENTS</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("RequireRole", () => {
  it("renders the gated content when the role is sufficient", async () => {
    mockAuthAs("admin");
    renderGated("admin");
    expect(await screen.findByText("SECRET")).toBeTruthy();
  });

  it("redirects to /agents when the role is insufficient", async () => {
    mockAuthAs("viewer");
    renderGated("admin");
    expect(await screen.findByText("AGENTS")).toBeTruthy();
    expect(screen.queryByText("SECRET")).toBeNull();
  });
});

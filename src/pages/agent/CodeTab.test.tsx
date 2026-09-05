// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The states that matter are the ones where the feature could destroy work or
// silently stop working: divergence, and an owning connection that is gone.

const connection = { id: "c1", github_login: "kobikis", expires_at: null };
let link: Record<string, unknown> | null = null;

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string) => {
    if (path === "/github/connection") return { data: connection };
    if (path.endsWith("/github")) return { data: link };
    if (path === "/github/repos") return { data: [] };
    return { data: [] };
  }),
  ApiError: class ApiError extends Error {},
  getActiveWorkspaceId: () => "ws-1",
}));

vi.mock("../../auth", () => ({
  useAuth: () => ({ activeWorkspace: { role: "editor" } }),
}));

vi.mock("./AgentPage", () => ({
  useAgent: () => ({ agentId: "a1", data: { backend: null } }),
}));

import CodeTab from "./CodeTab";

afterEach(() => {
  cleanup();
  link = null;
});

const show = () =>
  render(
    <MemoryRouter>
      <CodeTab />
    </MemoryRouter>
  );

it("offers no way to force past a divergent push", async () => {
  link = {
    owner: "kobikis",
    repo: "my-agents",
    branch: "main",
    path: "agents/sushi",
    connection_id: "c1",
    pushed_at: null,
    push_error: "has changes the builder did not make",
  };
  show();

  await waitFor(() =>
    expect(screen.getByText(/has changes the builder did not make/)).toBeTruthy()
  );
  // The whole point: explain and link out. No control may offer to force or
  // overwrite — the prose says "will not overwrite them", which is the opposite.
  const actions = screen.getAllByRole("button").map((b) => b.textContent || "");
  expect(actions.some((a) => /force|overwrite|discard/i.test(a))).toBe(false);
  expect(screen.getByText(/Review the changes on GitHub/)).toBeTruthy();
  expect(screen.getByText(/will not\s+overwrite them/)).toBeTruthy();
});

it("says nothing was deleted when the owning connection is gone", async () => {
  link = {
    owner: "kobikis",
    repo: "my-agents",
    branch: "main",
    path: "",
    connection_id: null,
    pushed_at: null,
    push_error: null,
  };
  show();

  await waitFor(() =>
    expect(screen.getByText(/connection that owned this link is gone/)).toBeTruthy()
  );
  expect(screen.getByText(/Nothing was deleted/)).toBeTruthy();
  // Pushing with no owning connection would 409 — don't offer it.
  expect(screen.getByRole("button", { name: "Push now" })).toHaveProperty("disabled", true);
});

it("explains why the repo list is empty rather than showing a blank dropdown", async () => {
  link = null;
  show();
  await waitFor(() =>
    expect(screen.getByText(/No repositories with write access/)).toBeTruthy()
  );
});

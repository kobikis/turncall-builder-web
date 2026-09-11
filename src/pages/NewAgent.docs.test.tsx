// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const calls: { path: string; method?: string }[] = [];
let readable = true;

vi.mock("../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method });
    if (path === "/providers/builder") return { data: { providers: [], default: null } };
    if (path === "/sessions") return { data: { session_id: "s1" } };
    if (path === "/sessions/s1/documents")
      return { data: { name: "menu.pdf", size: 3, readable } };
    throw new Error(`unexpected api call: ${path}`);
  }),
  ApiError: class ApiError extends Error {},
  getActiveWorkspaceId: () => "ws-1",
}));

import NewAgent from "./NewAgent";

Element.prototype.scrollTo = vi.fn();

afterEach(() => {
  calls.length = 0;
  readable = true;
  cleanup();
});

function attachMenu() {
  const { container } = render(
    <MemoryRouter>
      <NewAgent />
    </MemoryRouter>,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(["pdf"], "menu.pdf", { type: "application/pdf" })] },
  });
}

it("stages an attached document on the session rather than holding it in the browser", async () => {
  attachMenu();
  await waitFor(() => expect(screen.getByText("menu.pdf")).toBeDefined());

  // A session is created on the spot, because staging needs somewhere to go.
  expect(calls.some((c) => c.path === "/sessions" && c.method === "POST")).toBe(true);
  expect(calls.some((c) => c.path === "/sessions/s1/documents" && c.method === "POST")).toBe(true);
  // Never the agent's knowledge route — there is no agent yet.
  expect(calls.some((c) => c.path.includes("/knowledge/documents"))).toBe(false);
});

it("says so when the builder cannot read what was attached", async () => {
  readable = false;
  attachMenu();
  await waitFor(() => expect(screen.getByText("(unread)")).toBeDefined());
  expect(screen.getByText(/can't read the text/)).toBeDefined();
});

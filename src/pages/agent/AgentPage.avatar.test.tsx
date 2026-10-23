// @vitest-environment jsdom
//
// An Avatar with no ID is not saved (builder-api#124): TurnCall accepts the
// block, but no Avatar starts without an ID. Tested through the page's own
// Save, with the Avatar section as the open section and the API mocked.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const puts: unknown[] = [];
vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    if (path === "/agents/a1" && init?.method === "PUT") {
      puts.push(JSON.parse(init.body!).config);
      return { data: {} };
    }
    if (path === "/agents/a1") {
      return { data: { agent_id: "a1", config: { name: "Ann", pipeline_mode: "cascade" }, backend: null, tool_statuses: null, tool_signing_secret: null } };
    }
    throw new Error("unavailable"); // every catalog: the ID is typed
  }),
  getActiveWorkspaceId: () => "w1",
}));
vi.mock("../../auth", () => ({ useAuth: () => ({ activeWorkspace: { role: "editor" } }) }));

import AgentPage from "./AgentPage";
import ConfigTab from "./ConfigTab";

beforeEach(() => {
  puts.length = 0;
});
afterEach(cleanup);

it("refuses to save an Avatar with no ID, says why, and saves once it has one", async () => {
  render(
    <MemoryRouter initialEntries={["/agents/a1"]}>
      <Routes>
        <Route path="agents/:id" element={<AgentPage />}>
          <Route index element={<ConfigTab section="avatar" />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
  fireEvent.change(await screen.findByLabelText(/video avatar/i, { selector: "select" }), { target: { value: "tavus" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/not saved.*choose a replica id/i);
  expect(puts).toEqual([]);

  fireEvent.change(screen.getByLabelText(/replica id/i), { target: { value: "r1" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toMatchObject({ avatar: { enabled: true, provider: "tavus", replica_id: "r1" } });
  expect(screen.queryByRole("alert")).toBeNull();
});

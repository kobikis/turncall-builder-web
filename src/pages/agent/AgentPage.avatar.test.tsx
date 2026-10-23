// @vitest-environment jsdom
//
// An Avatar with no ID is not saved (builder-api#124): TurnCall accepts the
// block, but no Avatar starts without an ID. Tested through the page's own
// Save, with the Avatar section as the open section and the API mocked.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const puts: unknown[] = [];
// What GET /agents/a1 answers; each test may store an Avatar block first.
let stored: Record<string, unknown> = {};
vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    if (path === "/agents/a1" && init?.method === "PUT") {
      puts.push(JSON.parse(init.body!).config);
      return { data: {} };
    }
    if (path === "/agents/a1") {
      return { data: { agent_id: "a1", config: { name: "Ann", pipeline_mode: "cascade", ...stored }, backend: null, tool_statuses: null, tool_signing_secret: null } };
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
  stored = {};
});

function renderPage(...sections: ("avatar" | "prompt")[]) {
  render(
    <MemoryRouter initialEntries={["/agents/a1"]}>
      <Routes>
        <Route path="agents/:id" element={<AgentPage />}>
          <Route index element={<>{sections.map((s) => <ConfigTab key={s} section={s} />)}</>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}
afterEach(cleanup);

it("refuses to save an Avatar with no ID, says why, and saves once it has one", async () => {
  renderPage("avatar");
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

// LiveAvatar's sandbox refuses a session with any Avatar but its own. A block
// stored before the Console fixed that ID (TurnCall reads an unset is_sandbox
// as on) can carry another one, or none.
const SANDBOX_AVATAR = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";

it("refuses to save a sandbox Avatar with another ID, and the section puts the sandbox one back", async () => {
  stored = { avatar: { enabled: true, provider: "heygen", avatar_id: "av-ann" } };
  renderPage("prompt", "avatar");
  fireEvent.change(await screen.findByLabelText(/system prompt/i), { target: { value: "Be brief." } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/not saved.*sandbox/i);
  expect(puts).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: /use the sandbox avatar/i }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toMatchObject({ avatar: { enabled: true, provider: "heygen", is_sandbox: true, avatar_id: SANDBOX_AVATAR } });
});

it("a sandbox Avatar with no ID can be given the sandbox one", async () => {
  stored = { avatar: { enabled: true, provider: "heygen", is_sandbox: true } };
  renderPage("avatar");
  fireEvent.click(await screen.findByRole("button", { name: /use the sandbox avatar/i }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toMatchObject({ avatar: { is_sandbox: true, avatar_id: SANDBOX_AVATAR } });
});

it("a speech-to-speech agent saves whatever Avatar block it carries", async () => {
  // The Avatar section is not shown there, and TurnCall ignores the block
  // with a warning, so nothing on the page could fix what Save refused.
  stored = { pipeline_mode: "s2s", avatar: { enabled: true, provider: "tavus" } };
  renderPage("prompt");
  fireEvent.change(await screen.findByLabelText(/system prompt/i), { target: { value: "Be brief." } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(screen.queryByRole("alert")).toBeNull();
});

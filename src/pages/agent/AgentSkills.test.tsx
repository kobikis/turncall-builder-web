// @vitest-environment jsdom
//
// The Skills section of an agent's Build page (#126), through the page's
// own Save: pick published skills, pin one, set how many load at once,
// and see TurnCall's refusal of one entry on that entry.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const puts: Record<string, unknown>[] = [];
let stored: Record<string, unknown> = {};
let refusal: Record<string, unknown> | null = null;

const version = (name: string, n: number, state: string) => ({
  id: `${name}-v${n}`, name, version: n, state, description: "", instructions: "", tools: [],
});
const VERSIONS: Record<string, ReturnType<typeof version>[]> = {
  verify_caller: [version("verify_caller", 3, "draft"), version("verify_caller", 2, "published"), version("verify_caller", 1, "archived")],
  explain_bill: [version("explain_bill", 1, "published")],
};

vi.mock("../../api", async (orig) => {
  const actual = await orig<typeof import("../../api")>();
  return {
    ...actual,
    api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
      if (path === "/agents/a1" && init?.method === "PUT") {
        if (refusal) {
          const r = refusal;
          refusal = null;
          throw new actual.ApiError(String(r.detail), 422, { reason: "invalid_agent_config", errors: r.errors as any, body: r });
        }
        const config = JSON.parse(init.body!).config;
        puts.push(config);
        stored = config;
        return { data: {} };
      }
      if (path === "/agents/a1")
        return { data: { agent_id: "a1", config: { name: "Ann", pipeline_mode: "cascade", ...stored }, backend: null, tool_statuses: null, tool_signing_secret: null } };
      if (path === "/skills")
        return {
          data: {
            library: { project_id: "lib" },
            skills: [
              { name: "draft_only", description: "never published", live: null, draft: { id: "d1", version: 1 }, latest: {}, versions: 1 },
              { name: "explain_bill", description: "Use when the caller asks about a bill.", live: { id: "explain_bill-v1", version: 1 }, draft: null, latest: {}, versions: 1 },
              { name: "verify_caller", description: "Use before sharing account details.", live: { id: "verify_caller-v2", version: 2 }, draft: { id: "verify_caller-v3", version: 3 }, latest: {}, versions: 3 },
            ],
          },
        };
      const m = /^\/skills\/([a-z_]+)$/.exec(path);
      if (m) return { data: { name: m[1], live: null, versions: VERSIONS[m[1]] } };
      throw new Error("unavailable");
    }),
  };
});
let role = "editor";
vi.mock("../../auth", () => ({ useAuth: () => ({ activeWorkspace: { role } }) }));

import AgentPage from "./AgentPage";
import ConfigTab from "./ConfigTab";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/agents/a1"]}>
      <Routes>
        <Route path="agents/:id" element={<AgentPage />}>
          <Route index element={<ConfigTab section="skills" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));

beforeEach(() => {
  puts.length = 0;
  stored = {};
  refusal = null;
  role = "editor";
});
afterEach(cleanup);

it("offers only published skills", async () => {
  renderPage();
  const picker = await screen.findByLabelText("Skill to add");
  const offered = within(picker).getAllByRole("option").map((o) => o.textContent);
  expect(offered).toEqual(["explain_bill", "verify_caller"]);
});

it("pins to published and archived versions, never a draft", async () => {
  stored = { skills: [{ skill: "verify_caller" }] };
  renderPage();
  const pin = await screen.findByLabelText("Version of verify_caller");
  await waitFor(() => expect(within(pin).getAllByRole("option")).toHaveLength(3));
  expect(within(pin).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Follow the live version (now v2)", "Pin to v2 (live)", "Pin to v1 (archived)",
  ]);
});

it("saves skills and max_loaded_skills, and shows them on reload", async () => {
  renderPage();
  fireEvent.change(await screen.findByLabelText("Skill to add"), { target: { value: "verify_caller" } });
  fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
  fireEvent.click(screen.getByRole("button", { name: "Add skill" })); // explain_bill, the one left
  const pin = screen.getByLabelText("Version of verify_caller");
  await waitFor(() => expect(within(pin).getAllByRole("option")).toHaveLength(3));
  fireEvent.change(pin, { target: { value: "verify_caller-v1" } });
  fireEvent.change(screen.getByLabelText("Loaded at once"), { target: { value: "2" } });
  save();

  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toMatchObject({
    skills: [{ skill: "verify_caller", version_id: "verify_caller-v1" }, { skill: "explain_bill" }],
    max_loaded_skills: 2,
  });

  cleanup();
  renderPage();
  const again = await screen.findByLabelText("Version of verify_caller");
  await waitFor(() => expect((again as HTMLSelectElement).value).toBe("verify_caller-v1"));
  expect(screen.getByRole("listitem", { name: "Skill explain_bill" })).toBeTruthy();
  expect((screen.getByLabelText("Loaded at once") as HTMLInputElement).value).toBe("2");
});

it("shows TurnCall's refusal of skills[1] on the second entry", async () => {
  stored = { skills: [{ skill: "verify_caller" }, { skill: "explain_bill" }] };
  refusal = {
    detail: "skills[1] 'explain_bill' tool 'get_invoices' collides with the agent's own tool 'get_invoices'",
    errors: [{
      field: "skills[1]", skill: "explain_bill",
      message: "skills[1] 'explain_bill' tool 'get_invoices' collides with the agent's own tool 'get_invoices'",
    }],
  };
  renderPage();
  fireEvent.change(await screen.findByLabelText("Loaded at once"), { target: { value: "4" } });
  save();

  const second = screen.getByRole("listitem", { name: "Skill explain_bill" });
  await waitFor(() => expect(within(second).getByText(/collides with the agent's own tool/)).toBeTruthy());
  const first = screen.getByRole("listitem", { name: "Skill verify_caller" });
  expect(within(first).queryByText(/collides/)).toBeNull();
});

it("removing the last one drops the key", async () => {
  stored = { skills: [{ skill: "explain_bill" }] };
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Remove explain_bill" }));
  save();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).not.toHaveProperty("skills");
});

it("a viewer sees the agent's skills and cannot change them", async () => {
  role = "viewer";
  stored = { skills: [{ skill: "verify_caller", version_id: "verify_caller-v1" }] };
  renderPage();
  const pin = await screen.findByLabelText("Version of verify_caller");
  expect((pin as HTMLSelectElement).disabled).toBe(true);
  expect(screen.queryByLabelText("Skill to add")).toBeNull();
  expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  expect((screen.getByLabelText("Loaded at once") as HTMLInputElement).disabled).toBe(true);
});

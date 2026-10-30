// @vitest-environment jsdom
//
// The Skills page (#125), driven the way a person uses it, against a
// small in-memory Builder API that keeps TurnCall's version rules: only a draft
// is edited, publishing archives the live version, rolling back restores one.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

type Row = {
  id: string; project_id: string; name: string; version: number; state: string;
  description: string; instructions: string; tools: Record<string, unknown>[];
  knowledge_bases: unknown[]; warnings: unknown[]; created_at: string; updated_at: string;
  published_at: string | null;
};

let rows: Row[] = [];
const sent: { path: string; method: string; body?: any }[] = [];
// One refusal to answer the next matching request with.
let refuse: { path: RegExp; status: number; body: Record<string, unknown> } | null = null;
let seq = 0;
let uses: Record<string, unknown>[] = [];

const row = (over: Partial<Row>): Row => ({
  id: `v${++seq}`, project_id: "lib", name: "verify_caller", version: 1, state: "draft",
  description: "Use before sharing account details.", instructions: "Ask for the account number.",
  tools: [], knowledge_bases: [], warnings: [], created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z", published_at: null, ...over,
});

const ref = (r?: Row) => (r ? { id: r.id, version: r.version } : null);

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return {
    ...actual,
    api: vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ path, method, body });
      if (refuse && refuse.path.test(path) && method !== "GET") {
        const r = refuse;
        refuse = null;
        throw new actual.ApiError(String(r.body.detail), r.status, {
          reason: r.body.reason as string, errors: r.body.errors as any, body: r.body,
        });
      }
      if (path === "/capability-library") return { data: { library: null, links: [], complete: true } };
      if (path === "/capabilities" && method === "GET") {
        const names = [...new Set(rows.map((r) => r.name))].sort();
        return {
          data: {
            library: rows.length ? { project_id: "lib" } : null,
            capabilities: names.map((name) => {
              const vs = rows.filter((r) => r.name === name).sort((a, b) => b.version - a.version);
              const live = vs.find((v) => v.state === "published");
              return {
                name, description: (live ?? vs[0]).description, live: ref(live),
                draft: ref(vs.find((v) => v.state === "draft")),
                latest: { ...ref(vs[0]), state: vs[0].state }, versions: vs.length,
              };
            }),
          },
        };
      }
      if (path === "/capabilities" && method === "POST") {
        const version = Math.max(0, ...rows.filter((r) => r.name === body.name).map((r) => r.version)) + 1;
        const created = row({ ...body, version, state: "draft" });
        rows.push(created);
        return { data: created };
      }
      let m = /^\/capabilities\/([a-z_0-9]+)$/.exec(path);
      if (m) {
        const vs = rows.filter((r) => r.name === m![1]).sort((a, b) => b.version - a.version);
        return { data: { name: m[1], live: ref(vs.find((v) => v.state === "published")), versions: vs } };
      }
      if (/^\/capabilities\/[a-z_0-9]+\/agents$/.test(path)) return { data: uses };
      m = /^\/capability-versions\/([^/]+)(?:\/(publish|rollback))?$/.exec(path);
      if (m) {
        const target = rows.find((r) => r.id === m![1])!;
        if (method === "PUT") Object.assign(target, body);
        if (m[2]) {
          rows.filter((r) => r.name === target.name && r.state === "published").forEach((r) => (r.state = "archived"));
          target.state = "published";
          target.published_at = "2026-10-02T10:00:00Z";
        }
        if (method === "DELETE") rows = rows.filter((r) => r !== target);
        return { data: method === "DELETE" ? { deleted: target.id } : target };
      }
      return { data: {} };
    }),
  };
});

let role = "editor";
vi.mock("../auth", () => ({ useAuth: () => ({ activeWorkspace: { id: "ws-1", role } }) }));

import Capabilities from "./Capabilities";
import NewCapability from "./capabilities/NewCapability";
import CapabilityView from "./capabilities/CapabilityView";

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/skills" element={<Capabilities />} />
        <Route path="/skills/new" element={<NewCapability />} />
        <Route path="/skills/:name" element={<CapabilityView />} />
      </Routes>
    </MemoryRouter>,
  );

const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const versionPane = (n: number) => screen.getByRole("region", { name: `Version ${n}` });

beforeEach(() => {
  role = "editor";
  rows = [];
  refuse = null;
  seq = 0;
  uses = [];
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  sent.length = 0;
  cleanup();
  vi.restoreAllMocks();
});

it("lists each skill with its live version and a draft when it has one", async () => {
  rows = [
    row({ name: "verify_caller", version: 1, state: "archived" }),
    row({ name: "verify_caller", version: 2, state: "published" }),
    row({ name: "verify_caller", version: 3, state: "draft" }),
    row({ name: "book_table", version: 1, state: "draft" }),
  ];
  at("/skills");
  const line = (await screen.findByRole("link", { name: "verify_caller" })).closest("tr")!;
  expect(within(line).getByText("v2")).toBeTruthy();
  expect(within(line).getByText("Draft v3")).toBeTruthy();
  const other = screen.getByRole("link", { name: "book_table" }).closest("tr")!;
  expect(within(other).getByText("Not published")).toBeTruthy();
});

it("creates a skill as a draft, publishes it, and the list shows it live", async () => {
  at("/skills/new");
  type(screen.getByRole("textbox", { name: "Name" }), "verify_caller");
  type(screen.getByLabelText("When to use it"), "Use before sharing account details.");
  type(screen.getByLabelText("Instructions"), "Ask for the account number.");
  fireEvent.click(screen.getByText("Add tool"));
  type(screen.getByLabelText("Tool 1 name"), "verify_account");
  type(screen.getByLabelText("Tool 1 description"), "Checks an account.");
  type(screen.getByLabelText("Tool 1 URL"), "https://tools.example.com/verify");
  type(screen.getByLabelText("Tool 1 timeout"), "8");
  fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

  await screen.findByText(/Created verify_caller v1 as a draft/);
  const created = sent.find((s) => s.path === "/capabilities" && s.method === "POST")!.body;
  expect(created).toEqual({
    name: "verify_caller",
    description: "Use before sharing account details.",
    instructions: "Ask for the account number.",
    tools: [{
      name: "verify_account", description: "Checks an account.", webhook_url: "https://tools.example.com/verify",
      timeout_seconds: 8, parameters_schema: { type: "object", properties: {} },
    }],
  });

  // Edit the draft, then publish it: the edit is saved first.
  type(within(versionPane(1)).getByLabelText("Instructions"), "Ask for the account number and postcode.");
  fireEvent.click(screen.getByRole("button", { name: "Save and publish" }));
  await screen.findByText(/Published v1/);
  expect(sent.filter((s) => s.method !== "GET").map((s) => `${s.method} ${s.path}`)).toEqual([
    "POST /capabilities", "PUT /capability-versions/v1", "POST /capability-versions/v1/publish",
  ]);
  expect(rows[0].instructions).toBe("Ask for the account number and postcode.");

  cleanup();
  at("/skills");
  const line = (await screen.findByRole("link", { name: "verify_caller" })).closest("tr")!;
  expect(within(line).getByText("v1")).toBeTruthy();
});

it("starts the next version from the live one, prefilled", async () => {
  rows = [row({
    version: 1, state: "published", instructions: "Live instructions.",
    tools: [{ name: "verify_account", description: "d", webhook_url: "https://t.example/v", parameters_schema: { type: "object" } }],
  })];
  at("/skills/verify_caller");
  fireEvent.click(await screen.findByRole("button", { name: "New version from live" }));

  await screen.findByText(/Started v2 from v1/);
  const post = sent.find((s) => s.method === "POST")!.body;
  expect(post.instructions).toBe("Live instructions.");
  expect(post.tools[0].webhook_url).toBe("https://t.example/v");
  // The new draft is what's open, and it can be edited.
  const pane = versionPane(2);
  expect((within(pane).getByLabelText("Instructions") as HTMLTextAreaElement).value).toBe("Live instructions.");
  expect((within(pane).getByLabelText("Tool 1 URL") as HTMLInputElement).disabled).toBe(false);
  expect(screen.queryByRole("button", { name: "New version from live" })).toBeNull();
});

it("rolls back to an archived version, which becomes the live one", async () => {
  rows = [row({ version: 1, state: "archived" }), row({ version: 2, state: "published" })];
  at("/skills/verify_caller");
  fireEvent.click(await screen.findByRole("button", { name: "Roll back to v1" }));
  await screen.findByText(/v1 is live again/);
  expect(sent.some((s) => s.method === "POST" && s.path === "/capability-versions/v1/rollback")).toBe(true);
  expect(within(versionPane(1)).getByText("Live")).toBeTruthy();
});

it("shows a refused field on that field: a tool's URL on that tool", async () => {
  rows = [row({
    version: 1, state: "draft",
    tools: [
      { name: "lookup", description: "a", webhook_url: "https://t.example/a" },
      { name: "verify", description: "b", webhook_url: "http://t.example/b" },
    ],
  })];
  refuse = {
    path: /capability-versions/,
    status: 422,
    body: {
      detail: "Validation error", reason: "validation_error",
      errors: [{ field: "tools[1].webhook_url", message: "plain http is not allowed" }],
    },
  };
  at("/skills/verify_caller");
  type(await screen.findByLabelText("Instructions"), "Changed.");
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

  const url = await screen.findByLabelText("Tool 2 URL");
  await waitFor(() => expect(url.getAttribute("aria-invalid")).toBe("true"));
  expect(document.getElementById(url.getAttribute("aria-describedby")!)!.textContent).toMatch(/plain http/);
  expect(screen.getByLabelText("Tool 1 URL").getAttribute("aria-invalid")).toBeNull();
  expect(screen.getByRole("alert").textContent).toMatch(/Fix the fields marked below/);
});

it("refuses parameters that are not JSON on their own field, before sending", async () => {
  rows = [row({ version: 1, state: "draft", tools: [{ name: "lookup", description: "a", webhook_url: "https://t" }] })];
  at("/skills/verify_caller");
  type(await screen.findByLabelText("Tool 1 parameters"), "{ not json");
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(screen.getByLabelText("Tool 1 parameters").getAttribute("aria-invalid")).toBe("true"));
  expect(sent.some((s) => s.method === "PUT")).toBe(false);
});

it("a viewer reads every version and gets no way to change one", async () => {
  role = "viewer";
  rows = [
    row({ version: 1, state: "archived" }),
    row({ version: 2, state: "published", tools: [{ name: "lookup", description: "a", webhook_url: "https://t" }] }),
    row({ version: 3, state: "draft" }),
  ];
  at("/skills/verify_caller");
  await screen.findByRole("region", { name: "Version 3" });
  for (const name of [/new version/i, /roll back/i, /delete/i, /publish/i, /save draft/i, /add tool/i])
    expect(screen.queryByRole("button", { name })).toBeNull();
  expect((screen.getByLabelText("Instructions") as HTMLTextAreaElement).disabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Open v2" }));
  expect((within(versionPane(2)).getByLabelText("Tool 1 URL") as HTMLInputElement).disabled).toBe(true);

  cleanup();
  at("/skills");
  await screen.findByRole("link", { name: "verify_caller" });
  expect(screen.queryByText("+ New skill")).toBeNull();
});

it("deletes a version", async () => {
  rows = [row({ version: 1, state: "published" }), row({ version: 2, state: "draft" })];
  at("/skills/verify_caller");
  fireEvent.click(await screen.findByRole("button", { name: "Delete v2" }));
  await screen.findByText("Deleted v2.");
  expect(rows.map((r) => r.version)).toEqual([1]);
});

// ---- #127: who uses it, and the delete it blocks ---------------------------

const agent = (over: Record<string, unknown>) => ({
  agent_id: "ag-1", name: "Support", known: true, project_id: "p-1", turncall_agent_id: "t-1",
  agent_version: 2, agent_state: "published", ...over,
});

it("lists the agents using it, with the version each runs and whether it is pinned, linked", async () => {
  rows = [row({ version: 1, state: "archived" }), row({ version: 2, state: "published" })];
  uses = [
    { ...agent({}), resolved_skill_id: "v2", resolved_version: 2, pinned: false },
    { ...agent({ agent_id: "ag-2", name: "Billing", agent_state: "draft", agent_version: 1 }), resolved_skill_id: "v1", resolved_version: 1, pinned: true },
    { ...agent({ agent_id: null, name: null, known: false, project_id: "p-x" }), resolved_skill_id: null, resolved_version: null, pinned: true },
  ];
  at("/skills/verify_caller");
  const table = (await screen.findByRole("heading", { name: "Used by" })).parentElement!;

  const support = (await within(table).findByRole("link", { name: "Support" })).closest("tr")!;
  expect(support.querySelector("a")!.getAttribute("href")).toBe("/agents/ag-1");
  expect(within(support).getByText("v2")).toBeTruthy();
  expect(within(support).getByText("Follows live")).toBeTruthy();

  const billing = within(table).getByRole("link", { name: "Billing" }).closest("tr")!;
  expect(within(billing).getByText("v1")).toBeTruthy();
  expect(within(billing).getByText("Pinned")).toBeTruthy();

  const unknown = within(table).getByText(/unknown agent/).closest("tr")!;
  expect(unknown.textContent).toMatch(/project p-x/);
  expect(within(unknown).queryByRole("link")).toBeNull();
});

it("a refused delete names the agents that block it, linked", async () => {
  rows = [row({ version: 1, state: "published" })];
  refuse = {
    path: /capability-versions/,
    status: 409,
    body: {
      detail: "'verify_caller' is used by 'Support'; take it off them first",
      reason: "capability_in_use",
      capability: "verify_caller",
      agents: [agent({}), agent({ agent_id: null, name: "x", known: false, project_id: "p-x" })],
    },
  };
  at("/skills/verify_caller");
  fireEvent.click(await screen.findByRole("button", { name: "Delete v1" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/Not deleted.*used by 'Support'/);
  expect(within(alert).getByRole("link", { name: "Support" }).getAttribute("href")).toBe("/agents/ag-1");
  expect(alert.textContent).toMatch(/unknown agent \(project p-x\)/);
  expect(rows).toHaveLength(1);
});

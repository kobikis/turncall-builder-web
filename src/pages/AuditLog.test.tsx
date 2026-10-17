// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { AuthProvider } from "../auth";
import type { AuditEntry, EngineLinkEntries, Role } from "../types";

// The whole app, behind a stubbed fetch: the route gate, the rail and the page
// are what an admin (or an editor who pasted the link) actually meets.

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: "e0",
  user_id: "u1",
  user_email: "ann@x.com",
  role: "admin",
  resource_type: "agent",
  resource_id: "a1",
  resource_name: "Support bot",
  action: "updated",
  agent_ids: ["a1"],
  changes: {},
  request_id: "r0",
  engine_links: [],
  outcome: "completed",
  error: null,
  created_at: "2026-10-01T10:00:00Z",
  ...over,
});

const ENTRIES: AuditEntry[] = [
  entry({
    id: "e1",
    changes: {
      "/config/llm/model": { before: "gpt-4o", after: "gpt-4.1" },
      "/providers/deepgram_api_key": { before: "***", after: "***" },
    },
    engine_links: [
      { project_id: "p1", engine_audit_id: "eng-1" },
      { project_id: "p2", engine_audit_id: "eng-2" },
    ],
  }),
  entry({
    id: "e2",
    user_id: "u2",
    user_email: "bob@x.com",
    role: "editor",
    resource_type: "phone_number",
    resource_id: "n1",
    resource_name: "+15550100",
    action: "bound",
    agent_ids: ["a1", "a2"],
    outcome: "partial",
    error: "TurnCall refused the bind (409)",
    changes: { "/limits/max_calls": { after: 5, before_unknown: true } },
  }),
];

const ENGINE: EngineLinkEntries[] = [
  {
    project_id: "p1",
    engine_audit_id: "eng-1",
    entries: [
      {
        id: "x1",
        actor: "api_key",
        resource_type: "agent",
        resource_id: "tc-agent-1",
        action: "config_updated",
        changes: { "/llm/model": { before: "gpt-4o", after: "gpt-4.1" } },
        created_at: "2026-10-01T10:00:01Z",
      },
    ],
    error: null,
  },
  {
    project_id: "p2",
    engine_audit_id: "eng-2",
    entries: null,
    error: "TurnCall no longer accepts this project's key (the project was deleted)",
  },
];

let fetched: string[] = [];
let auditTotal = ENTRIES.length;

function stubApi(role: Role) {
  fetched = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(url);
      const path = url.replace(/^\/api/, "");
      const body = (() => {
        if (path === "/auth/me") return { data: { user: { id: "u1", email: "ann@x.com" } } };
        if (path === "/workspaces") return { data: { workspaces: [{ id: "w1", name: "W", role }] } };
        if (path === "/members")
          return {
            data: {
              members: [
                { user_id: "u1", email: "ann@x.com", role: "admin" },
                { user_id: "u2", email: "bob@x.com", role: "editor" },
              ],
            },
          };
        if (path === "/agents")
          return {
            data: {
              agents: [
                { agent_id: "a1", name: "Support bot", port: 1, status: "running" },
                { agent_id: "a2", name: "Sales bot", port: 2, status: "running" },
              ],
            },
          };
        if (path === "/agent-activity") return { data: { activity: [] } };
        if (path === "/audit/e1/engine") return { success: true, data: ENGINE };
        if (path.startsWith("/audit?"))
          return { success: true, data: ENTRIES, total: auditTotal, page: 1, limit: 50 };
        return { data: {} };
      })();
      return { ok: true, status: 200, json: async () => body };
    }),
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

// The query of the newest /audit list request.
const lastAuditQuery = () => {
  const url = [...fetched].reverse().find((u) => u.startsWith("/api/audit?"));
  return url ? new URLSearchParams(url.split("?")[1]) : null;
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  auditTotal = ENTRIES.length;
});

describe("Audit log, as an admin", () => {
  it("lists who did what and when, under Members, with its filters", async () => {
    stubApi("admin");
    renderAt("/members/audit");

    expect(await screen.findByText(/^bob@x\.com/, { selector: "td" })).toBeTruthy();
    expect(screen.getAllByText(/^ann@x\.com/, { selector: "td" })).toHaveLength(1);
    expect(screen.getByText("as editor")).toBeTruthy(); // the role they acted under
    expect(screen.getByText("updated")).toBeTruthy();
    expect(screen.getByText("Phone number")).toBeTruthy();
    expect(screen.getByText("+15550100")).toBeTruthy();
    // Agents are named from the agents list, not shown as ids.
    const row = screen.getByText("+15550100").closest("tr")!;
    expect(row.lastElementChild!.textContent).toBe("Support bot, Sales bot");

    // Under Members: the rail's Members link, and the sub-nav marks this page.
    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Audit log" }).getAttribute("aria-current")).toBe("page");

    // The filters, fed from the members and agents lists.
    const memberSel = screen.getByLabelText("Filter by member");
    await waitFor(() => expect(within(memberSel).getByText("bob@x.com")).toBeTruthy());
    expect(within(screen.getByLabelText("Filter by agent")).getByText("Sales bot")).toBeTruthy();
    expect(screen.getByLabelText("From date")).toBeTruthy();
    expect(screen.getByLabelText("To date")).toBeTruthy();

    // The first request asks for page 1 of everything.
    expect(Object.fromEntries(lastAuditQuery()!)).toEqual({ page: "1", limit: "50" });
  });

  it("marks a partial change with its error, and never shows a secret", async () => {
    stubApi("admin");
    renderAt("/members/audit");
    expect(await screen.findByText("partial")).toBeTruthy();
    expect(screen.getByText("TurnCall refused the bind (409)")).toBeTruthy();

    const annRow = screen.getByText(/^ann@x\.com/, { selector: "td" }).closest("tr")!;
    fireEvent.click(within(annRow).getByRole("button", { name: /Expand entry/ }));
    // The first entry: a readable diff, the secret masked on both sides.
    expect(await screen.findByText("config › llm › model")).toBeTruthy();
    expect(screen.getByText("gpt-4o")).toBeTruthy();
    expect(screen.getByText("gpt-4.1")).toBeTruthy();
    expect(screen.getByText("providers › deepgram_api_key")).toBeTruthy();
    expect(screen.getAllByText("hidden")).toHaveLength(2);
    expect(screen.queryByText("***")).toBeNull();

    // The partial one: its error in the drawer, a "before" nobody read as unknown.
    const partialRow = screen.getByText("+15550100").closest("tr")!;
    fireEvent.click(within(partialRow).getByRole("button", { name: /Expand entry/ }));
    expect(await screen.findByText("Only part of this change landed.")).toBeTruthy();
    expect(screen.getByText("unknown")).toBeTruthy();
    expect(screen.getByText("limits › max_calls")).toBeTruthy();
  });

  it("sends each filter to the API, and a filter change goes back to page 1", async () => {
    auditTotal = 120;
    stubApi("admin");
    renderAt("/members/audit");
    expect(await screen.findByText("1–50 of 120")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Older →" }));
    await waitFor(() => expect(lastAuditQuery()!.get("page")).toBe("2"));
    expect(await screen.findByText("51–100 of 120")).toBeTruthy();

    await waitFor(() => expect(within(screen.getByLabelText("Filter by member")).getByText("bob@x.com")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Filter by member"), { target: { value: "u2" } });
    await waitFor(() => expect(lastAuditQuery()!.get("member")).toBe("u2"));
    expect(lastAuditQuery()!.get("page")).toBe("1");

    fireEvent.change(screen.getByLabelText("Filter by agent"), { target: { value: "a2" } });
    await waitFor(() => expect(lastAuditQuery()!.get("agent")).toBe("a2"));
    expect(lastAuditQuery()!.get("member")).toBe("u2"); // filters combine

    // A local day range: since is that morning's midnight, until the midnight
    // after the last day (the API's until is exclusive).
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-10-03" } });
    await waitFor(() => expect(lastAuditQuery()!.get("until")).toBe(new Date(2026, 9, 4).toISOString()));
    expect(lastAuditQuery()!.get("since")).toBe(new Date(2026, 9, 1).toISOString());

    fireEvent.click(screen.getByRole("button", { name: "clear filters" }));
    await waitFor(() => expect(Object.fromEntries(lastAuditQuery()!)).toEqual({ page: "1", limit: "50" }));
  });

  it("reads TurnCall's own entries on demand, and says why a link can't be read", async () => {
    stubApi("admin");
    renderAt("/members/audit");
    const row = (await screen.findByText(/^ann@x\.com/, { selector: "td" })).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: /Expand entry/ }));

    expect(fetched).not.toContain("/api/audit/e1/engine"); // not until asked
    fireEvent.click(await screen.findByRole("button", { name: "Show TurnCall's entries (2 requests)" }));
    expect(await screen.findByText("config_updated")).toBeTruthy();
    expect(fetched).toContain("/api/audit/e1/engine");
    expect(screen.getByText("llm › model")).toBeTruthy();
    expect(screen.getByText(/the project was deleted/)).toBeTruthy();
  });

  it("says when a change never reached TurnCall", async () => {
    stubApi("admin");
    renderAt("/members/audit");
    const row = (await screen.findByText(/^bob@x\.com/, { selector: "td" })).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: /Expand entry/ }));
    expect(await screen.findByText(/did not reach TurnCall/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show TurnCall's entries/ })).toBeNull();
  });
});

describe.each<Role>(["editor", "viewer"])("Audit log, as an %s", (role) => {
  it("is not in the nav and the route bounces to Agents", async () => {
    stubApi(role);
    renderAt("/members/audit");
    expect(await screen.findByRole("heading", { name: /Agents/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Audit log" })).toBeNull();
    expect(fetched.some((u) => u.startsWith("/api/audit"))).toBe(false);
  });
});

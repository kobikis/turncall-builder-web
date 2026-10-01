// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RegisteredServer } from "./McpRegistry";

const calls: { path: string; method?: string; body?: unknown }[] = [];
let servers: RegisteredServer[] = [];

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body });
    if (path === "/integrations/mcp-servers" && !init?.method) return { data: servers };
    return { data: {} };
  }),
  ApiError: class ApiError extends Error {},
}));

import { McpRegistry } from "./McpRegistry";

beforeEach(() => {
  servers = [
    {
      id: "s1",
      name: "crm",
      transport: "http",
      url: "https://mcp.example.com/mcp",
      header_names: ["Authorization"],
      agents: ["a1"],
    },
  ];
});
afterEach(() => {
  calls.length = 0;
  cleanup();
});

it("lists servers with header names, never values", async () => {
  render(<McpRegistry isAdmin />);
  const row = await screen.findByTestId("mcp-crm");
  expect(row.textContent).toMatch(/headers: Authorization/);
  expect(row.textContent).toMatch(/1 agent/);
});

it("registers a server with write-only headers, offering only http and sse", async () => {
  servers = [];
  render(<McpRegistry isAdmin />);
  fireEvent.click(await screen.findByText("Register a server"));
  const transports = Array.from(screen.getByLabelText("Transport").querySelectorAll("option")).map(
    (o) => o.textContent,
  );
  expect(transports).toEqual(["http", "sse"]);

  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "crm" } });
  fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://m.test/mcp" } });
  fireEvent.change(screen.getByLabelText("Headers"), { target: { value: "Authorization: Bearer t" } });
  fireEvent.click(screen.getByText("Register"));

  await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
  expect(JSON.parse(String(calls.find((c) => c.method === "POST")!.body))).toEqual({
    name: "crm",
    transport: "http",
    url: "https://m.test/mcp",
    headers: { Authorization: "Bearer t" },
  });
});

it("keeps the saved headers when an edit leaves them blank", async () => {
  render(<McpRegistry isAdmin />);
  fireEvent.click(await screen.findByText("Edit"));
  expect((screen.getByLabelText("Headers") as HTMLTextAreaElement).value).toBe("");
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  expect(JSON.parse(String(calls.find((c) => c.method === "PUT")!.body)).headers).toBeNull();
});

it("shows a non-admin the list only", async () => {
  render(<McpRegistry isAdmin={false} />);
  await screen.findByTestId("mcp-crm");
  expect(screen.queryByText("Register a server")).toBeNull();
  expect(screen.queryByText("Edit")).toBeNull();
  expect(screen.queryByText("Remove")).toBeNull();
});

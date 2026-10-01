// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const calls: { path: string; method?: string; body?: unknown }[] = [];
let status: unknown = { connected: false, platform_project: true };

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body });
    return { data: status };
  }),
  ApiError: class ApiError extends Error {},
}));

import { PipedreamProject } from "./PipedreamProject";

beforeEach(() => {
  status = { connected: false, platform_project: true };
});
afterEach(() => {
  calls.length = 0;
  cleanup();
});

it("says the platform's project is in use until the workspace connects its own", async () => {
  render(<PipedreamProject isAdmin onChange={vi.fn()} />);
  expect(await screen.findByText(/platform's Pipedream project/)).toBeDefined();
  expect(screen.getByText("Platform project")).toBeDefined();
});

it("connects a project with a write-only secret, and refreshes the apps", async () => {
  const onChange = vi.fn();
  render(<PipedreamProject isAdmin onChange={onChange} />);
  fireEvent.click(await screen.findByText("Connect"));
  fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "cid" } });
  const secret = screen.getByLabelText("Client secret") as HTMLInputElement;
  expect(secret.type).toBe("password");
  fireEvent.change(secret, { target: { value: "pd-secret" } });
  fireEvent.change(screen.getByLabelText("Project ID"), { target: { value: "proj_1" } });
  status = { connected: true, client_id: "cid", project_id: "proj_1", environment: "production", platform_project: true };
  fireEvent.click(screen.getByText("Connect project"));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(JSON.parse(String(calls.find((c) => c.method === "PUT")!.body))).toEqual({
    client_id: "cid",
    client_secret: "pd-secret",
    project_id: "proj_1",
    environment: "production",
  });
  expect(await screen.findByText(/This workspace's project proj_1/)).toBeDefined();
  expect(document.body.textContent).not.toContain("pd-secret");
});

it("flags a deployment with no project at all", async () => {
  status = { connected: false, platform_project: false };
  render(<PipedreamProject isAdmin={false} onChange={vi.fn()} />);
  expect(await screen.findByText("Not configured")).toBeDefined();
  expect(screen.queryByText("Connect")).toBeNull();
});

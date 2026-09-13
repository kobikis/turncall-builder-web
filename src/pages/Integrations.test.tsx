// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const calls: { path: string; method?: string; body?: unknown }[] = [];
let connectedAccounts: unknown[] = [];

vi.mock("../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body });
    if (path === "/integrations/catalog")
      return {
        data: [
          { app: "slack_v2", name: "Slack", tools: ["slack_v2-post-message"] },
          { app: "google_calendar", name: "Google Calendar", tools: ["google_calendar-create-event"] },
        ],
      };
    if (path === "/integrations") return { data: connectedAccounts };
    if (path === "/integrations/connect")
      return { data: { connect_link_url: "https://pipedream.example/connect?token=ctok_1" } };
    return { data: {} };
  }),
  ApiError: class ApiError extends Error {},
}));

let role = "admin";
vi.mock("../auth", () => ({ useAuth: () => ({ activeWorkspace: { id: "ws-1", role } }) }));

import Integrations from "./Integrations";

const at = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/integrations${search}`]}>
      <Integrations />
    </MemoryRouter>,
  );

beforeEach(() => {
  role = "admin";
  connectedAccounts = [];
});
afterEach(() => {
  calls.length = 0;
  cleanup();
});

it("lists what the catalog offers", async () => {
  at("");
  await waitFor(() => expect(screen.getByText("Slack")).toBeDefined());
  expect(screen.getByText("Google Calendar")).toBeDefined();
});

it("sends the admin to Pipedream to authorize an app", async () => {
  // jsdom refuses a real navigation; the assertion is that we set it at all.
  const assign = vi.fn();
  Object.defineProperty(window, "location", { value: { set href(v: string) { assign(v); } }, writable: true });

  at("");
  await waitFor(() => expect(screen.getByText("Slack")).toBeDefined());

  fireEvent.click(screen.getAllByText("Connect")[0]);

  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith("https://pipedream.example/connect?token=ctok_1"),
  );
  expect(calls.find((c) => c.path === "/integrations/connect")?.body).toBe(
    JSON.stringify({ app: "slack_v2" }),
  );
});

it("announces the outcome the callback redirected back with", async () => {
  // Before this page existed the callback redirected to a route that did not
  // exist, so a successful authorization looked like nothing happening.
  at("?connected=slack_v2");
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/slack_v2 connected/));
});

it("shows the reason when the callback came back with one", async () => {
  at("?error=Slack%20was%20not%20connected.");
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toMatch(/Slack was not connected/),
  );
});

it("offers Disconnect for an app that is connected, and revokes it by account id", async () => {
  connectedAccounts = [{ id: "apn_1", app: "slack_v2", account_name: "acme" }];
  at("");
  await waitFor(() => expect(screen.getByText("Disconnect")).toBeDefined());
  expect(screen.getByText("acme")).toBeDefined();

  fireEvent.click(screen.getByText("Disconnect"));

  await waitFor(() =>
    expect(calls.find((c) => c.method === "DELETE")?.path).toBe("/integrations/apn_1"),
  );
});

it("lets an admin revoke an app the catalog no longer carries", async () => {
  // The grant still exists at Pipedream; hiding the row would strand it.
  connectedAccounts = [{ id: "apn_9", app: "notion" }];
  at("");
  await waitFor(() => expect(screen.getByText("notion")).toBeDefined());
  expect(screen.getByText(/No longer in the catalog/)).toBeDefined();
});

it("shows a non-admin what is connected but no way to change it", async () => {
  role = "editor";
  connectedAccounts = [{ id: "apn_1", app: "slack_v2" }];
  at("");
  await waitFor(() => expect(screen.getByText("Slack")).toBeDefined());

  expect(screen.queryByText("Connect")).toBeNull();
  expect(screen.queryByText("Disconnect")).toBeNull();
  expect(screen.getByText(/admin action/)).toBeDefined();
});

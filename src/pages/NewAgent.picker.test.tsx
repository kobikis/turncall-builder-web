// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock the api module before importing the page: /providers/builder feeds the
// Builder-model picker (providers + the deployment default).
vi.mock("../api", () => ({
  api: vi.fn(async (path: string) => {
    if (path === "/providers/builder") {
      return {
        data: {
          providers: [
            { name: "anthropic", available: true },
            { name: "openai", available: true },
          ],
          default: { provider: "anthropic", model: "claude-sonnet-4-6" },
        },
      };
    }
    throw new Error(`unexpected api call: ${path}`);
  }),
  ApiError: class ApiError extends Error {},
  getActiveWorkspaceId: () => "ws-1",
}));

import NewAgent from "./NewAgent";

// jsdom has no Element.scrollTo; the chat autoscroll effect calls it on mount.
Element.prototype.scrollTo = vi.fn();

afterEach(cleanup);

it("shows the deployment default provider/model in the picker", async () => {
  render(
    <MemoryRouter>
      <NewAgent />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "Default — anthropic / claude-sonnet-4-6" }),
    ).toBeDefined(),
  );
  // and it is the selected value of the provider select
  const select = screen.getByLabelText("Builder model") as HTMLSelectElement;
  expect(select.value).toBe("");
});

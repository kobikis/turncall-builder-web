// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const AC = "AC" + "d".repeat(32);

vi.mock("../api", () => ({
  api: vi.fn(async (path: string) => {
    if (path === "/agents") return { data: { agents: [{ agent_id: "a1", name: "Support" }] } };
    if (path === "/integrations/twilio") return { data: { connected: true, account_sid: AC, numbers: [] } };
    if (path === "/integrations/twilio/numbers")
      return {
        data: [
          { sid: "PN1", phone_number: "+15550001111", friendly_name: "Main", bound: false },
          { sid: "PN2", phone_number: "+15550002222", friendly_name: null, bound: true },
        ],
      };
    return { data: {} };
  }),
  ApiError: class ApiError extends Error {},
}));

import PhoneNumberForm from "./PhoneNumberForm";

afterEach(cleanup);

it("picks a number from the workspace's Twilio account instead of typing", async () => {
  const onSubmit = vi.fn(async (_body: Record<string, unknown>) => ({ data: {} }));
  render(
    <MemoryRouter>
      <PhoneNumberForm submitLabel="Bind number" onSubmit={onSubmit} />
    </MemoryRouter>,
  );
  const picker = (await screen.findByLabelText("Number on this account")) as HTMLSelectElement;
  await waitFor(() => expect(picker.querySelectorAll("option")).toHaveLength(3));
  // Already-added numbers are shown but cannot be picked twice.
  expect((picker.querySelector('option[value="PN2"]') as HTMLOptionElement).disabled).toBe(true);
  expect(screen.queryByLabelText("Twilio Auth Token")).toBeNull();

  fireEvent.change(picker, { target: { value: "PN1" } });
  await waitFor(() => expect(screen.getByText("Support")).toBeDefined());
  fireEvent.click(screen.getByText("Bind number"));

  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    e164: "+15550001111",
    sid: "PN1",
    use_workspace_twilio: true,
  });
  expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("twilio_auth_token");
});

it("can still bind with other credentials", async () => {
  render(
    <MemoryRouter>
      <PhoneNumberForm submitLabel="Bind number" onSubmit={vi.fn()} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByLabelText("Other credentials"));
  expect(screen.getByLabelText("Twilio Auth Token")).toBeDefined();
  expect(screen.queryByLabelText("Number on this account")).toBeNull();
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api", () => ({
  api: vi.fn(async (path: string) => {
    if (path === "/agents") return { data: { agents: [{ agent_id: "a1", name: "Support" }] } };
    return { data: {} };
  }),
  ApiError: class ApiError extends Error {},
}));

import PhoneNumberForm from "./PhoneNumberForm";

afterEach(cleanup);

const AC = "AC" + "b".repeat(32);

function show(initial = {}) {
  const onSubmit = vi.fn(async (_body: Record<string, unknown>) => ({ data: {} }));
  render(
    <MemoryRouter>
      <PhoneNumberForm initial={initial} submitLabel="Bind number" onSubmit={onSubmit} />
    </MemoryRouter>,
  );
  return onSubmit;
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

it("binds with the number's own Twilio account, no number SID needed", async () => {
  const onSubmit = show();
  await waitFor(() => expect(screen.getByLabelText("Agent")).toBeDefined());
  type("Twilio Phone Number", "+14156021922");
  type("Twilio Account SID", AC);
  type("Twilio Auth Token", "tok");
  expect(screen.queryByLabelText("Twilio Phone Number SID")).toBeNull();
  expect((screen.getByLabelText("Twilio Auth Token") as HTMLInputElement).type).toBe("password");

  fireEvent.click(screen.getByText("Bind number"));

  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    e164: "+14156021922",
    sid: "",
    twilio_account_sid: AC,
    twilio_auth_token: "tok",
  });
});

it("asks for the token when an account SID is entered without one", async () => {
  const onSubmit = show();
  type("Twilio Phone Number", "+14156021922");
  type("Twilio Account SID", AC);
  fireEvent.click(screen.getByText("Bind number"));
  expect((await screen.findByRole("alert")).textContent).toMatch(/Auth Token/);
  expect(onSubmit).not.toHaveBeenCalled();
});

it("keeps a saved account without re-sending or showing its token", async () => {
  const onSubmit = show({
    e164: "+14156021922",
    sid: "PN123456789",
    routing_type: "agent",
    agent_id: "a1",
    twilio_account_sid: AC,
    twilio_credentials: "number",
  });
  const token = screen.getByLabelText("Twilio Auth Token") as HTMLInputElement;
  expect(token.value).toBe("");
  expect(token.placeholder).toMatch(/leave blank to keep/);
  fireEvent.click(screen.getByText("Bind number"));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("twilio_auth_token");
});

it("still accepts a number SID on the platform's account", async () => {
  const onSubmit = show();
  await waitFor(() => expect(screen.getByLabelText("Agent")).toBeDefined());
  type("Twilio Phone Number", "+14156021922");
  type("Twilio Phone Number SID", "PN123456789");
  fireEvent.click(screen.getByText("Bind number"));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("twilio_account_sid");
});

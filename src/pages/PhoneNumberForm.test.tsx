// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const SUPPORT = { agent_id: "a1", name: "Support" };
const SALES = { agent_id: "a2", name: "Sales" };
let agents = [SUPPORT];

vi.mock("../api", () => ({
  api: vi.fn(async (path: string) => {
    if (path === "/agents") return { data: { agents } };
    return { data: {} };
  }),
  ApiError: class ApiError extends Error {},
}));

import PhoneNumberForm from "./PhoneNumberForm";

afterEach(() => {
  agents = [SUPPORT];
  cleanup();
});

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
  await waitFor(() => expect(screen.getByLabelText("Agent")).toBeDefined());
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

it("sends a trimmed label, and none when blank", async () => {
  const onSubmit = show({ e164: "+14156021922", sid: "PN123456789", routing_type: "none" });
  fireEvent.change(screen.getByLabelText("Label"), { target: { value: "  Support line " } });
  fireEvent.click(screen.getByText("Bind number"));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ label: "Support line" });
});

// Add Number binds to the agent the user picks (#107).
const agentPicker = () => screen.getByLabelText("Agent", { selector: "select" }) as HTMLSelectElement;
const bindButton = () => screen.getByRole("button", { name: "Bind number" }) as HTMLButtonElement;

it("with several agents, starts on a placeholder and won't bind until one is picked", async () => {
  agents = [SUPPORT, SALES];
  const onSubmit = show();
  await waitFor(() => expect(agentPicker().options.length).toBe(3));
  type("Twilio Phone Number", "+14156021922");
  type("Twilio Phone Number SID", "PN123456789");
  expect(agentPicker().value).toBe("");
  expect(agentPicker().selectedOptions[0].textContent).toBe("Choose an agent…");
  expect(bindButton().disabled).toBe(true);
  expect(screen.getByText("Choose an agent to bind the number to.").id).toBe(bindButton().getAttribute("aria-describedby"));
  fireEvent.click(bindButton());
  expect(onSubmit).not.toHaveBeenCalled();

  // Agent + caller info needs the agent too.
  fireEvent.click(screen.getByLabelText("Agent + caller info"));
  expect(bindButton().disabled).toBe(true);
  // Routings without an agent don't wait on one.
  fireEvent.click(screen.getByLabelText("Unassigned"));
  expect(bindButton().disabled).toBe(false);
  expect(screen.queryByText("Choose an agent to bind the number to.")).toBeNull();

  fireEvent.click(screen.getByLabelText("Agent", { selector: "input" }));
  fireEvent.change(agentPicker(), { target: { value: "a2" } });
  expect(bindButton().disabled).toBe(false);
  expect(Array.from(agentPicker().options).map((o) => o.value)).toEqual(["a1", "a2"]);
  fireEvent.click(bindButton());
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ routing_type: "agent", agent_id: "a2" });
});

it.each([false, true])("with exactly one agent, preselects it (bind mode: %s)", async (bind) => {
  const onSubmit = vi.fn(async (_body: Record<string, unknown>) => ({ data: {} }));
  render(
    <MemoryRouter>
      <PhoneNumberForm bind={bind} initial={{}} submitLabel="Bind number" onSubmit={onSubmit} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(agentPicker().value).toBe("a1"));
  expect(screen.queryByText("Choose an agent…")).toBeNull();
  type("Twilio Phone Number", "+14156021922");
  type("Twilio Phone Number SID", "PN123456789");
  fireEvent.click(bindButton());
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ agent_id: "a1" });
});

it("with several agents, a bound number keeps its agent", async () => {
  agents = [SUPPORT, SALES];
  show({ e164: "+14156021922", sid: "PN123456789", routing_type: "agent", agent_id: "a2" });
  await waitFor(() => expect(agentPicker().options.length).toBe(2));
  expect(agentPicker().value).toBe("a2");
  expect(bindButton().disabled).toBe(false);
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The manual test view, and the button that turns the conversation you just
// had by hand into a check that runs forever (turncall#87).
//
// It could not exist until TurnCall learned to derive a scenario from a text
// session: a chat test is a session, and `from-call` reads a call's transcript
// events. The button therefore appears only once there is a session to save —
// which is why the session id is state rather than a ref.

// jsdom implements no scrolling, and the chat pane scrolls itself on every new
// message. Stubbed here rather than globally: it is this component's need.
Element.prototype.scrollTo = () => {};

const calls: { path: string; body?: unknown }[] = [];

vi.mock("../../api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body });
    if (path.endsWith("/chat"))
      return { data: { reply: "We close at nine.", session_id: "sess-7" } };
    if (path.endsWith("/from-session"))
      return {
        data: {
          name: "session-sess-7",
          definition: { turns: [] },
          tool_mocks: {},
          tool_policy: "mock_only",
          note: "1 turn(s) captured. The expectations are a draft — trim them.",
        },
      };
    return { data: {} };
  }),
  ApiError: class ApiError extends Error {},
}));

let draft: unknown = undefined;
vi.mock("./AgentPage", () => ({ useAgent: () => ({ agentId: "a1", draft }) }));

import TestTab from "./TestTab";

afterEach(() => {
  calls.length = 0;
  draft = undefined;
  localStorage.clear();
  cleanup();
});

const chat = async (text: string) => {
  fireEvent.change(screen.getByLabelText("Message the agent"), { target: { value: text } });
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(screen.getByText("We close at nine.")).toBeDefined());
};

it("offers nothing to save before there is a conversation", () => {
  render(<TestTab />);
  expect(screen.queryByText(/Save this conversation/)).toBeNull();
});

it("offers to save once the agent has answered", async () => {
  render(<TestTab />);
  await chat("what are your hours?");
  expect(screen.getByText("Save this conversation as a scenario")).toBeDefined();
});

it("derives from the session the conversation created", async () => {
  render(<TestTab />);
  await chat("what are your hours?");
  fireEvent.click(screen.getByText("Save this conversation as a scenario"));

  await waitFor(() => expect(screen.getByText("Review before saving")).toBeDefined());
  const derive = calls.find((c) => c.path.endsWith("/from-session"))!;
  expect(String(derive.body)).toContain("sess-7");
  // Nothing is stored until the draft has been read.
  expect(String(derive.body)).toContain('"save":false');
});

it("resetting the conversation withdraws the offer", async () => {
  render(<TestTab />);
  await chat("what are your hours?");
  fireEvent.click(screen.getByText("Reset"));
  await waitFor(() => expect(screen.queryByText(/Save this conversation/)).toBeNull());
});

it("the session is threaded through the conversation", async () => {
  render(<TestTab />);
  await chat("first");
  fireEvent.change(screen.getByLabelText("Message the agent"), { target: { value: "second" } });
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(calls.filter((c) => c.path.endsWith("/chat")).length).toBe(2));
  // The first send opens a session; the second continues it rather than
  // starting a new one, which is what makes the saved scenario a conversation.
  expect(String(calls.filter((c) => c.path.endsWith("/chat"))[1].body)).toContain("sess-7");
});

it("shows no variables when the prompt has no placeholders", () => {
  draft = { system_prompt: "You are helpful." };
  render(<TestTab />);
  expect(screen.queryByText("Variables")).toBeNull();
});

it("asks for each placeholder and sends the filled ones with the message", async () => {
  draft = { system_prompt: "Ship to {{address}} for {{name}}." };
  render(<TestTab />);
  fireEvent.change(screen.getByLabelText("address"), { target: { value: "12 Herzl St" } });
  await chat("where is my order?");

  const sent = JSON.parse(String(calls.find((c) => c.path.endsWith("/chat"))!.body));
  // `name` was left empty, so the agent sees {{name}} as on a call without it.
  expect(sent.variables).toEqual({ address: "12 Herzl St" });
});

it("remembers the values for the next visit", () => {
  draft = { system_prompt: "Hi {{name}}." };
  const first = render(<TestTab />);
  fireEvent.change(screen.getByLabelText("name"), { target: { value: "Ada" } });
  first.unmount();

  render(<TestTab />);
  expect((screen.getByLabelText("name") as HTMLInputElement).value).toBe("Ada");
});

it("sends no variables when none are filled", async () => {
  draft = { system_prompt: "Hi {{name}}." };
  render(<TestTab />);
  await chat("hi");
  const sent = JSON.parse(String(calls.find((c) => c.path.endsWith("/chat"))!.body));
  expect(sent).not.toHaveProperty("variables");
});

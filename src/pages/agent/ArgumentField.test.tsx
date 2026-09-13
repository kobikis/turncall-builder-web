// @vitest-environment jsdom
//
// The picker's whole reason for existing is that its absence fails invisibly —
// so what matters is that it degrades to a text field on every path where the
// list cannot be shown, and that it never drops a value someone already saved.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const paths: string[] = [];
let answer: () => unknown;

class FakeApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

vi.mock("../../api", () => ({
  ApiError: FakeApiError,
  api: vi.fn(async (path: string) => {
    paths.push(path);
    return answer();
  }),
}));

const { ArgumentField } = await import("./ArgumentField");

const CHANNEL = { name: "channel", label: "Channel", placeholder: "#sales", options: true };
const TITLE = { name: "summary", label: "Event title", placeholder: "Customer call" };

const OPTIONS = [
  { value: "C0C1", label: "calls" },
  { value: "CKLE", label: "general" },
];

function show(
  input: typeof CHANNEL | typeof TITLE,
  value = "",
  onChange: (next: string) => void = () => {},
) {
  return render(
    <ArgumentField
      app="slack_v2"
      appName="Slack"
      input={input}
      value={value}
      editable
      onChange={onChange}
    />,
  );
}

beforeEach(() => {
  paths.length = 0;
  answer = () => ({ data: OPTIONS });
});
afterEach(cleanup);

it("offers a list when the catalog says the value is chosen", async () => {
  show(CHANNEL);
  const field = (await screen.findByLabelText("Slack: Channel")) as HTMLSelectElement;
  expect(field.tagName).toBe("SELECT");
  expect([...field.options].map((o) => o.textContent)).toEqual(["Choose…", "calls", "general"]);
  expect(paths).toEqual(["/integrations/slack_v2/options/channel"]);
});

it("asks nothing of the API for an input that is typed", () => {
  show(TITLE);
  expect((screen.getByLabelText("Slack: Event title") as HTMLElement).tagName).toBe("INPUT");
  expect(paths).toEqual([]);
});

it("falls back to typing when the list cannot be fetched, and says why", async () => {
  answer = () => {
    throw new FakeApiError("No Slack account is connected yet.", 400);
  };
  show(CHANNEL);
  await waitFor(() =>
    expect((screen.getByLabelText("Slack: Channel") as HTMLElement).tagName).toBe("INPUT"),
  );
  expect(screen.getByText("No Slack account is connected yet.")).toBeTruthy();
});

it("falls back to typing when the list comes back empty", async () => {
  // "You have no channels" is not something a Workspace can act on, and an
  // empty dropdown would strand them with no way to enter anything.
  answer = () => ({ data: [] });
  show(CHANNEL);
  await waitFor(() =>
    expect((screen.getByLabelText("Slack: Channel") as HTMLElement).tagName).toBe("INPUT"),
  );
});

it("keeps a stored value the list no longer contains", async () => {
  // An archived channel, or one saved before there was a picker. Dropping it
  // would change a saved setting because a page rendered.
  show(CHANNEL, "C-GONE");
  const field = (await screen.findByLabelText("Slack: Channel")) as HTMLSelectElement;
  expect(field.value).toBe("C-GONE");
  expect([...field.options].some((o) => o.textContent?.includes("no longer listed"))).toBe(true);
});

it("reports a chosen value by its id, not its name", async () => {
  const seen: string[] = [];
  show(CHANNEL, "", (next) => {
    seen.push(next);
  });
  const field = (await screen.findByLabelText("Slack: Channel")) as HTMLSelectElement;
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.change(field, { target: { value: "CKLE" } });
  expect(seen).toEqual(["CKLE"]);
});

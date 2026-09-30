// @vitest-environment jsdom
//
// What matters here: "off" is the key's absence (a null block is TurnCall's
// 422), an upload is chosen and its warnings shown, TurnCall's refusals reach
// the person verbatim, and a saved sound that no longer exists is said out loud.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const ROOM = { id: "s1", name: "room.mp3", duration_ms: 30000, rates: [8000, 16000] };
const calls: { path: string; init?: RequestInit }[] = [];
let answers: Record<string, () => unknown>;

class FakeApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

vi.mock("../../api", () => ({
  ApiError: FakeApiError,
  getActiveWorkspaceId: () => "ws-1",
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    const key = `${init?.method || "GET"} ${path}`;
    if (!(key in answers)) throw new Error(`unexpected ${key}`);
    return answers[key]();
  }),
}));

const { Ambience } = await import("./Ambience");

const LIST = "GET /agents/a1/ambience/sounds";

beforeEach(() => {
  calls.length = 0;
  answers = { [LIST]: () => ({ data: { sounds: [ROOM] } }) };
  vi.stubGlobal("confirm", () => true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(
  value?: { sound: string; volume?: number },
  onChange = vi.fn(),
  savedSound?: string,
) {
  render(<Ambience agentId="a1" value={value} savedSound={savedSound} editable onChange={onChange} />);
  return onChange;
}

it("None clears the block rather than sending a null one", async () => {
  const onChange = show({ sound: "s1", volume: 0.3 });
  fireEvent.click(await screen.findByLabelText("None"));
  expect(onChange).toHaveBeenCalledWith(undefined);
});

it("choosing a sound keeps the volume already set", async () => {
  const onChange = show(undefined);
  fireEvent.click(await screen.findByRole("radio", { name: /room\.mp3/ }));
  expect(onChange).toHaveBeenCalledWith({ sound: "s1", volume: 0.3 });
});

it("volume only shows once a sound is chosen, and edits the chosen block", async () => {
  const onChange = show({ sound: "s1", volume: 0.3 });
  const slider = await screen.findByLabelText(/Volume/);
  fireEvent.change(slider, { target: { value: "0.5" } });
  expect(onChange).toHaveBeenCalledWith({ sound: "s1", volume: 0.5 });

  cleanup();
  show(undefined);
  await screen.findByRole("radio", { name: /room\.mp3/ });
  expect(screen.queryByLabelText(/Volume/)).toBeNull();
});

it("an upload is chosen and its phone warning shown", async () => {
  answers["POST /agents/a1/ambience/sounds"] = () => ({
    data: {
      ...ROOM,
      id: "s2",
      name: "rumble.wav",
      warnings: [{ code: "inaudible_on_phone", message: "a phone will carry little of it" }],
    },
  });
  const onChange = show(undefined);
  await screen.findByRole("radio", { name: /room\.mp3/ });

  const file = new File(["x"], "rumble.wav", { type: "audio/wav" });
  fireEvent.change(screen.getByLabelText("Upload ambience sound"), { target: { files: [file] } });

  expect(await screen.findByText("a phone will carry little of it")).toBeTruthy();
  expect(onChange).toHaveBeenCalledWith({ sound: "s2", volume: 0.3 });
  expect(screen.getByRole("radio", { name: /rumble\.wav/ })).toBeTruthy();
  const body = calls.find((c) => c.init?.method === "POST")?.init?.body;
  expect(body).toBeInstanceOf(FormData);
});

it("TurnCall's refusal reaches the person verbatim — the .m4a fix is in it", async () => {
  answers["POST /agents/a1/ambience/sounds"] = () => {
    throw new FakeApiError("convert it first, e.g. `ffmpeg -i memo.m4a memo.wav`", 415);
  };
  const onChange = show(undefined);
  await screen.findByRole("radio", { name: /room\.mp3/ });

  const file = new File(["x"], "memo.m4a", { type: "audio/mp4" });
  fireEvent.change(screen.getByLabelText("Upload ambience sound"), { target: { files: [file] } });

  expect((await screen.findByRole("alert")).textContent).toContain("ffmpeg");
  expect(onChange).not.toHaveBeenCalled();
});

it("deleting the chosen sound turns ambience off", async () => {
  answers["DELETE /agents/a1/ambience/sounds/s1"] = () => ({ data: { deleted: "s1" } });
  const onChange = show({ sound: "s1" });

  fireEvent.click(await screen.findByLabelText("Delete room.mp3"));

  await waitFor(() => expect(onChange).toHaveBeenCalledWith(undefined));
  expect(screen.queryByRole("radio", { name: /room\.mp3/ })).toBeNull();
});

it("a sound still in use stays, with TurnCall's 409 shown", async () => {
  answers["DELETE /agents/a1/ambience/sounds/s1"] = () => {
    throw new FakeApiError("Ambience sound is used by Nonna v1", 409);
  };
  const onChange = show({ sound: "s1" });

  fireEvent.click(await screen.findByLabelText("Delete room.mp3"));

  expect((await screen.findByRole("alert")).textContent).toContain("Nonna v1");
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("radio", { name: /room\.mp3/ })).toBeTruthy();
});

it("a saved sound that is gone is said out loud", async () => {
  show({ sound: "deleted-elsewhere" });
  expect(await screen.findByText(/no longer in this project/)).toBeTruthy();
});

it("preview fetches the phone rendition with the workspace header", async () => {
  const fetchMock = vi.fn(async () => new Response(new Blob(["mp3"]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
  show(undefined);

  fireEvent.click(await screen.findByLabelText("Preview room.mp3"));

  await screen.findByLabelText("Ambience preview");
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/agents/a1/ambience/sounds/s1/audio?rate=8000");
  expect(init.headers).toEqual({ "X-Workspace-Id": "ws-1" });
});

it("the saved sound offers no delete, and says how to free it", async () => {
  show({ sound: "s1" }, vi.fn(), "s1");
  await screen.findByRole("radio", { name: /room\.mp3/ });
  expect(screen.queryByLabelText("Delete room.mp3")).toBeNull();
  expect(screen.getByText(/choose None and Save to free it/)).toBeTruthy();
});

it("once None is chosen but not yet saved, it says Save", async () => {
  show(undefined, vi.fn(), "s1");
  await screen.findByRole("radio", { name: /room\.mp3/ });
  expect(screen.queryByLabelText("Delete room.mp3")).toBeNull();
  expect(screen.getByText(/in use — Save to free it/)).toBeTruthy();
});

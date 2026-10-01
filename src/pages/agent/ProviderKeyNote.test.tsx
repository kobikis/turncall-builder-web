// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProviderKeyNote, type ProviderCard } from "./ProviderKeyNote";
import { McpServers } from "./McpServers";

afterEach(cleanup);

const card = (over: Partial<ProviderCard>): ProviderCard => ({
  provider: "cartesia",
  serves: { tts: ["cartesia"] },
  connected: false,
  last4: null,
  validation: null,
  disconnecting: false,
  platform_key: false,
  runs_on: "none",
  agents_using: 0,
  pinned_agents: [],
  agents: [],
  ...over,
});

it("warns, naming the provider, when no key exists anywhere", () => {
  render(<ProviderKeyNote role="tts" provider="cartesia" cards={[card({})]} />);
  const note = screen.getByRole("note");
  expect(note.textContent).toMatch(/No cartesia key/);
  expect(note.textContent).toMatch(/You can still save/);
});

it("says the platform's key will be used, distinctly from a warning", () => {
  render(<ProviderKeyNote role="tts" provider="cartesia" cards={[card({ runs_on: "platform", platform_key: true })]} />);
  expect(screen.queryByRole("note")).toBeNull();
  expect(screen.getByText(/platform's cartesia key/)).toBeDefined();
});

it("says nothing when the workspace has the key", () => {
  const { container } = render(
    <ProviderKeyNote role="tts" provider="cartesia" cards={[card({ runs_on: "workspace", connected: true })]} />,
  );
  expect(container.textContent).toBe("");
});

it("maps a role provider to the account that bills it", () => {
  const openai = card({ provider: "openai", serves: { s2s: ["openai", "openai_live"] } });
  render(<ProviderKeyNote role="s2s" provider="openai_live" cards={[openai]} />);
  expect(screen.getByRole("note").textContent).toMatch(/No openai key/);
});

it("lets an agent opt into a registered server, and only the one it picks", () => {
  const onSelect = vi.fn();
  render(
    <McpServers
      servers={[]}
      editable
      onChange={vi.fn()}
      registered={[
        { id: "s1", name: "crm", transport: "http", url: "https://crm.test" },
        { id: "s2", name: "docs", transport: "sse", url: "https://docs.test" },
      ]}
      selected={["s2"]}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByLabelText(/crm/));
  expect(onSelect).toHaveBeenCalledWith(["s2", "s1"]);
});

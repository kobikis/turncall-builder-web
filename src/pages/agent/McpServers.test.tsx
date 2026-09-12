// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { McpServers, parseHeaders } from "./McpServers";

afterEach(cleanup);

// The states worth pinning are the ones where the form could lose a credential,
// offer something the backend refuses, or blank an agent's servers by accident.

describe("header parsing", () => {
  it("reads one header per line", () => {
    expect(parseHeaders("Authorization: Bearer t\nX-Tenant: acme")).toEqual({
      Authorization: "Bearer t",
      "X-Tenant": "acme",
    });
  });

  it("keeps a value that contains colons", () => {
    // A URL or a timestamp in a header value would otherwise be truncated.
    expect(parseHeaders("X-Origin: https://a.example:8443/x")).toEqual({
      "X-Origin": "https://a.example:8443/x",
    });
  });

  it("ignores a line that isn't a header yet", () => {
    expect(parseHeaders("Authorization")).toEqual({});
    expect(parseHeaders(": novalue")).toEqual({});
  });
});

describe("the form", () => {
  it("does not offer stdio — the mapper refuses it", () => {
    render(<McpServers servers={[{ transport: "http" }]} editable onChange={vi.fn()} />);

    const options = Array.from(
      screen.getByLabelText("Transport").querySelectorAll("option"),
    ).map((o) => o.textContent);

    expect(options).toEqual(["http", "sse"]);
  });

  it("adds a server with a usable default rather than an empty row", () => {
    const onChange = vi.fn();
    render(<McpServers servers={[]} editable onChange={onChange} />);

    fireEvent.click(screen.getByText("Add MCP server"));

    expect(onChange).toHaveBeenCalledWith([
      { name: "", transport: "http", url: "" },
    ]);
  });

  it("edits one server without disturbing its neighbour", () => {
    const onChange = vi.fn();
    const servers = [
      { name: "crm", transport: "http", url: "https://a/mcp" },
      { name: "docs", transport: "sse", url: "https://b/sse" },
    ];
    render(<McpServers servers={servers} editable onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("URL", { selector: "#mcp-url-0" }), {
      target: { value: "https://changed/mcp" },
    });

    expect(onChange).toHaveBeenCalledWith([
      { name: "crm", transport: "http", url: "https://changed/mcp" },
      servers[1],
    ]);
  });

  it("keeps a half-typed header on screen instead of swallowing it", () => {
    // parseHeaders drops "Authorization" until it has a colon and a value. If the
    // textarea rendered from the parsed object, the characters would disappear
    // as they were typed.
    const onChange = vi.fn();
    const { rerender } = render(
      <McpServers servers={[{ transport: "http" }]} editable onChange={onChange} />,
    );
    const box = screen.getByLabelText("Headers");

    fireEvent.change(box, { target: { value: "Authorization" } });
    rerender(
      <McpServers servers={[{ transport: "http" }]} editable onChange={onChange} />,
    );

    expect((box as HTMLTextAreaElement).value).toBe("Authorization");
  });

  it("removes a server", () => {
    const onChange = vi.fn();
    render(
      <McpServers
        servers={[{ name: "crm" }, { name: "docs" }]}
        editable
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getAllByText("Remove")[0]);

    expect(onChange).toHaveBeenCalledWith([{ name: "docs" }]);
  });

  it("gives viewers no way to change anything", () => {
    render(
      <McpServers servers={[{ name: "crm" }]} editable={false} onChange={vi.fn()} />,
    );

    expect(screen.queryByText("Add MCP server")).toBeNull();
    expect(screen.queryByText("Remove")).toBeNull();
    expect((screen.getByLabelText("URL") as HTMLInputElement).disabled).toBe(true);
  });

  it("says where the headers end up", () => {
    render(<McpServers servers={[{ name: "crm" }]} editable onChange={vi.fn()} />);

    expect(screen.getByText(/not encrypted at rest/)).toBeTruthy();
  });
});

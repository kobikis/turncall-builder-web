import { useState } from "react";
import { Section } from "./Section";

// The transports the Console can offer. stdio is deliberately absent: it runs a
// subprocess on the TurnCall host, and the builder's mapper refuses it (ADR-0017),
// so offering it here would be a field that silently does nothing.
const TRANSPORTS = ["http", "sse"] as const;

export type McpServer = {
  name?: string;
  transport?: string;
  url?: string;
  headers?: Record<string, string>;
};

/** `{"Authorization": "Bearer x"}` <-> `Authorization: Bearer x` per line. */
function headersToText(headers: Record<string, string> | undefined): string {
  return Object.entries(headers || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf(":");
    if (at < 1) continue; // no colon, or a line that starts with one
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

type Props = {
  servers: McpServer[];
  editable: boolean;
  onChange: (servers: McpServer[]) => void;
};

/**
 * MCP servers on an agent.
 *
 * They reach TurnCall from here and never from the interview (ADR-0017): a
 * composer would have to invent an outbound URL and handle a bearer token typed
 * into a chat transcript. Typed by someone who knows them, neither problem
 * exists — which is what this form is for.
 */
export function McpServers({ servers, editable, onChange }: Props) {
  // Header text is held per-row while editing so a half-typed line doesn't
  // vanish on re-parse ("Authorization" alone is not a header yet).
  const [headerText, setHeaderText] = useState<Record<number, string>>({});

  const update = (i: number, patch: Partial<McpServer>) =>
    onChange(servers.map((s, n) => (n === i ? { ...s, ...patch } : s)));

  const remove = (i: number) => {
    setHeaderText({});
    onChange(servers.filter((_, n) => n !== i));
  };

  const add = () =>
    onChange([...servers, { name: "", transport: "http", url: "" }]);

  return (
    <Section id="mcp" title="MCP servers" hint={servers.length || ""}>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
        Tool servers the agent connects out to — Slack, a calendar, your own CRM.
        Their tools are discovered when a call starts and offered to the model
        alongside the agent's own.
      </p>

      {servers.map((server, i) => (
        <div
          key={i}
          style={{
            border: "1px solid var(--border, #ddd)",
            padding: 12,
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "1 1 10rem" }}>
              <label htmlFor={`mcp-name-${i}`}>Name</label>
              <input
                id={`mcp-name-${i}`}
                className="input"
                value={server.name || ""}
                disabled={!editable}
                placeholder="crm"
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: "0 0 7rem" }}>
              <label htmlFor={`mcp-transport-${i}`}>Transport</label>
              <select
                id={`mcp-transport-${i}`}
                className="input"
                value={server.transport || "http"}
                disabled={!editable}
                onChange={(e) => update(i, { transport: e.target.value })}
              >
                {TRANSPORTS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: "2 1 16rem" }}>
              <label htmlFor={`mcp-url-${i}`}>URL</label>
              <input
                id={`mcp-url-${i}`}
                className="input"
                value={server.url || ""}
                disabled={!editable}
                placeholder="https://mcp.example.com/mcp"
                onChange={(e) => update(i, { url: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor={`mcp-headers-${i}`}>Headers</label>
            <textarea
              id={`mcp-headers-${i}`}
              className="input"
              rows={2}
              disabled={!editable}
              placeholder="Authorization: Bearer …"
              value={headerText[i] ?? headersToText(server.headers)}
              onChange={(e) => {
                setHeaderText({ ...headerText, [i]: e.target.value });
                update(i, { headers: parseHeaders(e.target.value) });
              }}
            />
            <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
              One per line, <code>Name: value</code>. Stored with the agent's
              configuration, which is not encrypted at rest — use a token scoped to
              what this agent needs.
            </p>
          </div>

          {editable && (
            <button className="btn" onClick={() => remove(i)}>
              Remove
            </button>
          )}
        </div>
      ))}

      {editable && (
        <button className="btn" onClick={add}>
          Add MCP server
        </button>
      )}

      <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
        A server the agent can't reach costs it those tools, not the call — discovery
        gives up after a few seconds and the agent starts without them.
      </p>
    </Section>
  );
}

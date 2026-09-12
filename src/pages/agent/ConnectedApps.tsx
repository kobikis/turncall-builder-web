// The in-call half of integrations (ADR-0018). The post-call half — Automations —
// is deliberately not a Console feature: it is a handler in the agent's own
// backend, because nothing about it has to reach TurnCall.

export type CatalogApp = { app: string; name: string; tools: string[] };

export type ConnectedAccount = {
  id: string;
  app: string;
  name?: string;
  account_name?: string | null;
};

type Props = {
  /** App slugs attached to this agent. */
  apps: string[];
  /** Apps this build can connect, with the tools each contributes. */
  catalog: CatalogApp[];
  /** What the Workspace has actually authorized. */
  connected: ConnectedAccount[];
  editable: boolean;
  onChange: (apps: string[]) => void;
};

/** Attached apps first, then anything connected but not attached. */
export function pickable(
  apps: string[],
  catalog: CatalogApp[],
  connected: ConnectedAccount[],
): CatalogApp[] {
  const known = new Map(catalog.map((a) => [a.app, a]));
  const slugs = [...apps, ...connected.map((c) => c.app)];
  const seen = new Set<string>();
  const out: CatalogApp[] = [];
  for (const slug of slugs) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    // An app attached before it was disconnected still belongs on the list —
    // otherwise it is attached to the agent with no way to take it off.
    out.push(known.get(slug) || { app: slug, name: slug, tools: [] });
  }
  return out;
}

/**
 * Connected apps on an agent.
 *
 * Attaching one adds an MCP server the builder writes for you, with a pinned
 * tool allowlist — Pipedream generates a tool per action in an app's registry
 * (50 for Slack), and every advertised tool rides in every request for the
 * length of the call.
 */
export function ConnectedApps({ apps, catalog, connected, editable, onChange }: Props) {
  const rows = pickable(apps, catalog, connected);
  const authorized = new Set(connected.map((c) => c.app));

  const toggle = (slug: string) => {
    // `disabled` is what a browser enforces; this is what enforces it when the
    // event does not come from one. A viewer must not be able to change an
    // attachment, and the attribute alone is a presentation detail.
    if (!editable) return;
    onChange(apps.includes(slug) ? apps.filter((a) => a !== slug) : [...apps, slug]);
  };

  return (
    <fieldset style={{ border: 0, padding: 0, margin: "0 0 16px" }}>
      <legend style={{ padding: 0, fontWeight: 500, fontSize: 13 }}>Connected apps</legend>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
        Apps your workspace has authorized. Attach one and the agent can use it
        during a call — book a meeting, post a message — without you writing a
        tool for it.
      </p>

      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          No apps connected yet. A workspace admin connects Slack or Google
          Calendar once, and every agent here can then use them.
        </p>
      ) : (
        rows.map((row) => {
          const attached = apps.includes(row.app);
          return (
            <div
              key={row.app}
              style={{
                border: "1px solid var(--border, #ddd)",
                padding: 12,
                marginBottom: 10,
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={attached}
                  disabled={!editable}
                  onChange={() => toggle(row.app)}
                />
                <strong>{row.name}</strong>
                {!authorized.has(row.app) && (
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    — no longer connected
                  </span>
                )}
              </label>

              {attached && (
                <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0 26px" }}>
                  {row.tools.length > 0 ? (
                    <>
                      Gives the agent:{" "}
                      {row.tools.map((t) => t.replace(`${row.app}-`, "")).join(", ")}
                    </>
                  ) : (
                    <>Contributes no tools — the agent will not be able to use it.</>
                  )}
                </p>
              )}
            </div>
          );
        })
      )}

      <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
        Credentials never live in this configuration — they are minted for each
        call and expire within the hour.
      </p>
    </fieldset>
  );
}

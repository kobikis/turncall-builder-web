// Which Connected apps this agent uses, and when (ADR-0018, ADR-0021).
//
// Two triggers, deliberately not symmetric. Mid-call exposes the app's tools and
// the model calls them if it decides to — a set, with arguments supplied at
// runtime. End-of-call runs one Action because the event arrived, so both the
// action and its arguments are chosen here. Connecting an app is a Workspace
// act and lives on /integrations; this is the per-agent half.

export type CatalogApp = { app: string; name: string; tools: string[] };

export type ConnectedAccount = {
  id: string;
  app: string;
  name?: string;
  account_name?: string | null;
};

export type CallEnded = {
  action: string;
  args: Record<string, string>;
  summary_arg: string;
};

export type Attachment = {
  app: string;
  mid_call?: boolean;
  call_ended?: CallEnded;
};

/** What `config.integrations` holds: the object form, or a legacy bare slug. */
export type AttachmentValue = string | Attachment;

type Parsed = { app: string; midCall: boolean; callEnded: CallEnded | null };

/**
 * Read one entry in either shape — the same widening the API does.
 *
 * A bare slug is the pre-ADR-0021 form and means mid-call only. Reading it as
 * anything else would turn an end-of-call trigger on for an agent whose owner
 * never asked for one.
 */
export function readAttachment(entry: AttachmentValue): Parsed {
  if (typeof entry === "string") return { app: entry, midCall: true, callEnded: null };
  const ce = entry.call_ended;
  return {
    app: entry.app,
    midCall: Boolean(entry.mid_call),
    callEnded:
      ce && ce.action
        ? { action: ce.action, args: ce.args || {}, summary_arg: ce.summary_arg || "" }
        : null,
  };
}

/**
 * Write one entry back, dropping it when neither trigger is set.
 *
 * An entry with no trigger is refused by the API, and rightly: it would read as
 * attached while exposing nothing and posting nothing. Removing it here is what
 * unchecking the last box means.
 */
export function writeAttachment(parsed: Parsed): Attachment | null {
  if (!parsed.midCall && !parsed.callEnded) return null;
  const out: Attachment = { app: parsed.app };
  if (parsed.midCall) out.mid_call = true;
  if (parsed.callEnded) out.call_ended = parsed.callEnded;
  return out;
}

/** Attached apps first, then anything connected but not attached. */
export function pickable(
  apps: AttachmentValue[],
  catalog: CatalogApp[],
  connected: ConnectedAccount[],
): CatalogApp[] {
  const known = new Map(catalog.map((a) => [a.app, a]));
  const slugs = [...apps.map((a) => readAttachment(a).app), ...connected.map((c) => c.app)];
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

type Props = {
  /** Attachments on this agent, in either shape. */
  apps: AttachmentValue[];
  /** Apps this build can connect, with the tools each contributes. */
  catalog: CatalogApp[];
  /** What the Workspace has actually authorized. */
  connected: ConnectedAccount[];
  editable: boolean;
  onChange: (apps: AttachmentValue[]) => void;
};

const shortName = (app: string, tool: string) => tool.replace(`${app}-`, "");

export function ConnectedApps({ apps, catalog, connected, editable, onChange }: Props) {
  const rows = pickable(apps, catalog, connected);
  const authorized = new Set(connected.map((c) => c.app));
  const parsed = new Map(apps.map((a) => [readAttachment(a).app, readAttachment(a)]));

  const update = (slug: string, next: Partial<Parsed>) => {
    // `disabled` is what a browser enforces; this is what enforces it when the
    // event does not come from one. A viewer must not be able to change an
    // attachment, and the attribute alone is a presentation detail.
    if (!editable) return;
    const current = parsed.get(slug) || { app: slug, midCall: false, callEnded: null };
    const written = writeAttachment({ ...current, ...next });
    const others = apps.filter((a) => readAttachment(a).app !== slug);
    onChange(written ? [...others, written] : others);
  };

  return (
    <fieldset style={{ border: 0, padding: 0, margin: "0 0 16px" }}>
      <legend style={{ padding: 0, fontWeight: 500, fontSize: 13 }}>Connected apps</legend>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
        Apps your workspace has authorized. Choose when each one runs: during a
        call, so the agent can use it — or when a call ends, to post a summary.
      </p>

      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          No apps connected yet. A workspace admin connects Slack or Google
          Calendar once on the Integrations page, and every agent here can then
          use them.
        </p>
      ) : (
        rows.map((row) => {
          const state = parsed.get(row.app) || {
            app: row.app,
            midCall: false,
            callEnded: null,
          };
          const ce = state.callEnded;
          return (
            <div
              key={row.app}
              style={{ border: "1px solid var(--border, #ddd)", padding: 12, marginBottom: 10 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong>{row.name}</strong>
                {!authorized.has(row.app) && (
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    — no longer connected
                  </span>
                )}
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={state.midCall}
                  disabled={!editable}
                  // Named per app: a screen reader hearing "available during
                  // calls" three times has no way to tell which app it is on.
                  aria-label={`${row.name}: available during calls`}
                  onChange={() => update(row.app, { midCall: !state.midCall })}
                />
                Available during calls
              </label>
              {state.midCall && (
                <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0 26px" }}>
                  {row.tools.length > 0 ? (
                    <>
                      The agent may call:{" "}
                      {row.tools.map((t) => shortName(row.app, t)).join(", ")} — it
                      decides whether to, like any other tool.
                    </>
                  ) : (
                    <>Contributes no tools — the agent will not be able to use it.</>
                  )}
                </p>
              )}

              <label style={{ display: "block", marginTop: 10 }}>
                When a call ends
                <select
                  value={ce?.action || ""}
                  disabled={!editable || row.tools.length === 0}
                  aria-label={`${row.name}: when a call ends`}
                  style={{ display: "block", marginTop: 4 }}
                  onChange={(e) =>
                    update(row.app, {
                      callEnded: e.target.value
                        ? {
                            action: e.target.value,
                            args: ce?.args || {},
                            summary_arg: ce?.summary_arg || "",
                          }
                        : null,
                    })
                  }
                >
                  <option value="">Do nothing</option>
                  {row.tools.map((t) => (
                    <option key={t} value={t}>
                      {shortName(row.app, t)}
                    </option>
                  ))}
                </select>
              </label>

              {ce && (
                <div
                  style={{
                    marginTop: 8,
                    paddingLeft: 12,
                    borderLeft: "2px solid var(--border, #ddd)",
                  }}
                >
                  <p className="muted" style={{ fontSize: 12.5, margin: "0 0 6px" }}>
                    This runs because the call ended, not because the agent chose
                    it. The summary is written for you — name the input it goes
                    into, and fill in whatever else the action needs.
                  </p>
                  <label style={{ display: "block", fontSize: 12.5 }}>
                    Summary goes into
                    <input
                      value={ce.summary_arg}
                      disabled={!editable}
                      aria-label={`${row.name}: summary goes into`}
                      placeholder="e.g. text"
                      style={{ display: "block", marginTop: 4 }}
                      onChange={(e) =>
                        update(row.app, {
                          callEnded: { ...ce, summary_arg: e.target.value },
                        })
                      }
                    />
                  </label>
                  <ArgsEditor
                    args={ce.args}
                    editable={editable}
                    onChange={(args) => update(row.app, { callEnded: { ...ce, args } })}
                  />
                </div>
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

/**
 * The action's other inputs, as name/value pairs.
 *
 * Free-form because nothing here knows an action's schema: the builder runs
 * Pipedream actions but never asks what arguments they take (ADR-0021,
 * "Generality"). Until it does, the honest control is a pair of text boxes.
 */
function ArgsEditor({
  args,
  editable,
  onChange,
}: {
  args: Record<string, string>;
  editable: boolean;
  onChange: (args: Record<string, string>) => void;
}) {
  const entries = Object.entries(args);
  const set = (index: number, key: string, value: string) => {
    const next = entries.map((e, i) => (i === index ? [key, value] : e));
    onChange(Object.fromEntries(next));
  };
  return (
    <div style={{ marginTop: 8 }}>
      <span className="muted" style={{ fontSize: 12.5 }}>
        Other inputs
      </span>
      {entries.map(([key, value], i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <input
            value={key}
            disabled={!editable}
            aria-label="Input name"
            placeholder="e.g. channel"
            onChange={(e) => set(i, e.target.value, value)}
          />
          <input
            value={value}
            disabled={!editable}
            aria-label={`Value for ${key || "input"}`}
            placeholder="e.g. #sales-calls"
            onChange={(e) => set(i, key, e.target.value)}
          />
          <button
            type="button"
            disabled={!editable}
            onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={!editable}
        style={{ marginTop: 4 }}
        onClick={() => onChange({ ...args, "": "" })}
      >
        Add input
      </button>
    </div>
  );
}

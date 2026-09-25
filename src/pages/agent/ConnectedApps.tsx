// Which Connected apps this agent uses, and when (ADR-0018, ADR-0021).
//
// Two triggers, deliberately not symmetric. Mid-call exposes the app's tools and
// the model calls them if it decides to — a set, with arguments supplied at
// runtime. End-of-call runs one Action because the event arrived, so both the
// action and its arguments are chosen here. Connecting an app is a Workspace
// act and lives on /integrations; this is the per-agent half.

import { Link } from "react-router-dom";

import { AppHead, describe, shortTool, type CatalogAction, type CatalogApp } from "../../apps";
import { ArgumentField } from "./ArgumentField";
import { Section } from "./Section";

export type { CatalogApp };

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

/** One row of the generated backend's `GET /automations` (#47). */
export type AutomationRun = {
  at: string;
  action: string;
  ok: boolean;
  reason: string;
  detail: string;
};

/**
 * The most recent run of one Action, or null if it has never run.
 *
 * Never-run and every-run-failed are different answers and the card says which,
 * so this returns null rather than a synthesised failure.
 */
export function lastRun(runs: AutomationRun[], action: string): AutomationRun | null {
  // The backend answers newest first; don't re-sort on a field we'd have to
  // trust, just take the first match.
  return runs.find((r) => r.action === action) || null;
}

/**
 * What the card says about a run, and who can do something about it.
 *
 * The four failures are kept apart all the way from the handler to here.
 * `not_connected` is an admin's problem, `refused` an editor's, `unfilled` means
 * the call had nothing to put in a required field, and `error` is the network.
 * Collapsing them into "failed" is what makes a status line worth ignoring.
 */
export function explain(run: AutomationRun, appName: string): { tone: string; text: string } {
  if (run.ok) return { tone: "muted", text: "Ran when the last call ended." };
  switch (run.reason) {
    case "not_connected":
      return {
        tone: "danger",
        text: `Did not run — nobody has ${appName} connected. Connect it on Integrations.`,
      };
    case "refused":
      return { tone: "danger", text: `${appName} refused it: ${run.detail}. Check the settings below.` };
    case "unfilled":
      return { tone: "warn", text: `Did not run — ${run.detail}.` };
    default:
      return { tone: "danger", text: `Failed: ${run.detail || "the action did not complete"}.` };
  }
}

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

/**
 * Turn a chosen Action id into the stored shape.
 *
 * `summary_arg` comes from the catalog, never from a person: it is the same
 * string for every Workspace that ever picks this Action, and asking someone to
 * type a constant is not configuration (ADR-0021). Arguments survive a change of
 * Action only where the new one has an input of the same name — carrying over a
 * channel into an Action that has no channel would store a value nothing reads.
 */
export function pick(
  actions: CatalogAction[],
  id: string,
  current: CallEnded | null,
): CallEnded | null {
  const action = actions.find((a) => a.id === id);
  if (!action) return null;
  const keep = new Set(action.inputs.map((i) => i.name));
  const args = Object.fromEntries(
    Object.entries(current?.args || {}).filter(([k]) => keep.has(k)),
  );
  return { action: action.id, args, summary_arg: action.summary_arg };
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
  /** App slugs the builder said this agent needs (ADR-0021). Advisory: it
   *  attaches nothing, so an unmet one is worth saying out loud. */
  needs?: string[];
  /** What this agent's Automations actually did, newest first. Empty while the
   *  backend is unreachable — the card then says nothing rather than lying. */
  runs?: AutomationRun[];
  editable: boolean;
  onChange: (apps: AttachmentValue[]) => void;
};

/** The last thing this Automation did, or that it has not run yet. */
function AutomationStatus({ run, appName }: { run: AutomationRun | null; appName: string }) {
  if (!run) {
    return (
      <p className="hint" style={{ margin: "0 0 6px" }}>
        Hasn&rsquo;t run yet &mdash; it runs when this agent&rsquo;s next call ends.
      </p>
    );
  }
  const { tone, text } = explain(run, appName);
  return (
    <p
      className={tone === "muted" ? "muted" : `desc ${tone}`}
      style={{ margin: "0 0 6px" }}
    >
      {text}{" "}
      <span className="muted">{new Date(run.at).toLocaleString()}</span>
    </p>
  );
}

export function ConnectedApps({ apps, catalog, connected, needs = [], runs = [], editable, onChange }: Props) {
  const rows = pickable(apps, catalog, connected);
  const authorized = new Set(connected.map((c) => c.app));
  const parsed = new Map(apps.map((a) => [readAttachment(a).app, readAttachment(a)]));
  // A need is met once the app is attached at all — after that, which triggers
  // it runs on is an ordinary choice, not an unfinished setup step.
  const unmet = needs
    .filter((slug) => !parsed.has(slug))
    .map((slug) => ({
      slug,
      name: catalog.find((a) => a.app === slug)?.name || slug,
      authorized: authorized.has(slug),
    }));

  // What a collapsed section still says. A heading alone would make minimizing
  // it a choice between the grid and knowing whether anything is attached.
  const inUse = rows.filter((r) => parsed.has(r.app)).length;

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
    <div style={{ margin: "0 0 16px" }}>
      {/* The builder cannot attach an app, so when it decided the agent needs
          one it could only write it down. Saying nothing here would leave the
          agent quietly missing the capability it was built around.

          Outside the collapsible part on purpose: this is a call to action, and
          minimizing the section must not be a way to lose it. */}
      {unmet.map(({ slug, name, authorized }) => (
        <div className="callout warn" key={slug} style={{ marginBottom: 10 }}>
          <strong>This agent needs {name}.</strong>{" "}
          {authorized ? (
            <>Turn on &ldquo;available during calls&rdquo; for it below.</>
          ) : (
            <>
              Nobody has connected it yet — <Link to="/integrations">connect {name}</Link>,
              then turn it on below.
            </>
          )}
        </div>
      ))}

      <Section id="integrations" title="Connected apps" hint={inUse > 0 ? `${inUse} in use` : ""}>
      <p className="hint" style={{ margin: "0 0 10px" }}>
        Apps your workspace has authorized. Choose when each one runs: during a
        call, so the agent can use it — or when a call ends, to post a summary.
      </p>

      {rows.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          No apps connected yet. A workspace admin connects Slack or Google
          Calendar once on the Integrations page, and every agent here can then
          use them.
        </p>
      ) : (
        <div className="integration-grid wide">
        {rows.map((row) => {
          const state = parsed.get(row.app) || {
            app: row.app,
            midCall: false,
            callEnded: null,
          };
          const ce = state.callEnded;
          const actions = row.actions || [];
          const chosen = actions.find((a) => a.id === ce?.action);
          return (
            <div className="integration-card" key={row.app}>
              {/* An attached app whose grant is gone reads as `lost`: its tools
                  are still advertised to the model and answer nothing, which is
                  a fault to fix rather than a neutral state. */}
              <AppHead row={row} status={authorized.has(row.app) ? "connected" : "lost"} />
              <div className="name">{row.name}</div>
              {authorized.has(row.app) ? (
                <p className="desc">{describe(row)}</p>
              ) : (
                <p className="desc danger">
                  The workspace revoked this app. It is still attached here, so the
                  agent is offered tools that will not answer — take it off, or
                  reconnect it on Integrations.
                </p>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                <p className="hint" style={{ margin: "4px 0 0 26px" }}>
                  {row.tools.length > 0 ? (
                    <>
                      The agent may call:{" "}
                      {row.tools.map((t) => shortTool(row.app, t)).join(", ")} — it
                      decides whether to, like any other tool.
                    </>
                  ) : (
                    <>Contributes no tools — the agent will not be able to use it.</>
                  )}
                </p>
              )}

              {actions.length > 0 ? (
                <label style={{ display: "block", marginTop: 10 }}>
                  When a call ends
                  <select
                    className="input"
                    value={ce?.action || ""}
                    disabled={!editable}
                    aria-label={`${row.name}: when a call ends`}
                    style={{ display: "block", marginTop: 4 }}
                    onChange={(e) => update(row.app, { callEnded: pick(actions, e.target.value, ce) })}
                  >
                    <option value="">Do nothing</option>
                    {actions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="hint" style={{ margin: "10px 0 0" }}>
                  Nothing to run when a call ends — this app has no Action that a
                  finished call has the information for.
                </p>
              )}

              {ce && chosen && (
                <div
                  style={{
                    marginTop: 8,
                    paddingLeft: 12,
                    borderLeft: "2px solid var(--border, #ddd)",
                  }}
                >
                  <p className="hint" style={{ margin: "0 0 6px" }}>
                    Runs because the call ended, not because the agent chose to.
                    The agent's own summary of the call is included automatically.
                  </p>
                  {/* Configuring something in a UI and never hearing from it
                      again is how a Slack post that stopped arriving reads as a
                      quiet week (#47). Silence here means it has not run yet —
                      which is not the same as having failed, and says so. */}
                  <AutomationStatus run={lastRun(runs, ce.action)} appName={row.name} />
                  {chosen.inputs.map((input) => (
                    <ArgumentField
                      key={input.name}
                      app={row.app}
                      appName={row.name}
                      input={input}
                      value={ce.args[input.name] || ""}
                      editable={editable}
                      onChange={(next) =>
                        update(row.app, {
                          callEnded: { ...ce, args: { ...ce.args, [input.name]: next } },
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        </div>
      )}

      <p className="hint" style={{ margin: "8px 0 0" }}>
        Credentials never live in this configuration — they are minted for each
        call and expire within the hour.
      </p>
      </Section>
    </div>
  );
}

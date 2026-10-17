import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { entitiesOf, type WorkspaceReport } from "../compliance";
import { fmtTime } from "../dates";
import {
  ProjectionBadge,
  RedactionCopy,
  RedactionEditor,
  RetentionCopy,
  RetentionEditor,
  redactionToSend,
  retentionForm,
  retentionToSend,
  useRun,
  type RedactionForm,
  type RetentionForm,
} from "./compliance/Fields";

// The Workspace's compliance settings (builder-api #103, ADR-0028): redaction
// and call retention, set once here and written into every Agent's TurnCall
// project. Admin-only, like Members: the route is gated (RequireRole "admin")
// and so is every call — even reading it, since it lists every Agent.

export default function Compliance() {
  const [report, setReport] = useState<WorkspaceReport | null>(null);
  // The entity types come with the report; until it is in, the form is disabled.
  const [redaction, setRedaction] = useState<RedactionForm>({ enabled: false, picked: [] });
  const [retention, setRetention] = useState<RetentionForm>(() => retentionForm(null, false));
  const { busy, error, notice, run, refuse, setNotice } = useRun();

  const supported = report?.entity_types.supported ?? [];
  const defaults = report?.entity_types.default ?? [];

  const take = (r: WorkspaceReport) => {
    setReport(r);
    setRedaction({ enabled: r.redaction.enabled, picked: entitiesOf(r.redaction, r.entity_types.default) });
    setRetention(retentionForm(r.retention, false));
  };

  useEffect(() => {
    api<{ data: WorkspaceReport }>("/compliance")
      .then((r) => take(r.data))
      .catch((e) => refuse(e instanceof Error ? e.message : "Could not load the compliance settings."));
  }, []);

  const save = () => {
    const red = redactionToSend(redaction, defaults);
    const ret = retentionToSend(retention, false);
    const invalid = red.error ?? ret.error;
    if (invalid) return refuse(invalid);
    const body = { redaction: red.redaction, retention: ret.retention };
    return run(async () => {
      const r = await api<{ data: WorkspaceReport }>("/compliance", { method: "PUT", body: JSON.stringify(body) });
      take(r.data);
      return r.data.complete ? "Saved, and written into every agent." : "Saved. Not every agent holds it yet; see below.";
    });
  };

  const apply = () =>
    run(async () => {
      const r = await api<{ data: WorkspaceReport }>("/compliance/apply", { method: "POST" });
      take(r.data);
      return r.data.complete ? "Every agent holds the setting now." : "Some agents still do not hold it; see below.";
    });

  const loaded = report !== null;
  const failed = report ? report.agents.some((a) => a.state === "failed") || report.webhook_numbers?.state === "failed" : false;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Compliance</h2>
          <p>
            Redaction and call retention for every agent in this Workspace. An agent can override them in its
            own settings.
          </p>
        </div>
      </div>

      {report && !report.set && (
        <div className="callout">
          Not set yet: every agent runs on TurnCall's defaults, no redaction and everything kept.
        </div>
      )}

      <section aria-labelledby="cmp-redaction">
        <h3 id="cmp-redaction">Redaction</h3>
        <RedactionCopy />
        <RedactionEditor
          idPrefix="ws"
          value={redaction}
          onChange={(v) => { setRedaction(v); setNotice(""); }}
          supported={supported}
          defaults={defaults}
          disabled={!loaded || busy}
        />
      </section>

      <section aria-labelledby="cmp-retention" style={{ marginTop: 24 }}>
        <h3 id="cmp-retention">Retention</h3>
        <RetentionCopy />
        <RetentionEditor
          idPrefix="ws"
          value={retention}
          onChange={(v) => { setRetention(v); setNotice(""); }}
          disabled={!loaded || busy}
        />
      </section>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0 12px" }}>
        <button className="btn btn-primary" disabled={!loaded || busy} onClick={save}>
          Save compliance settings
        </button>
        {report?.updated_at && <span className="hint">Last saved {fmtTime(report.updated_at)}</span>}
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
      {notice && <div className="callout info" role="status">{notice}</div>}

      <section aria-labelledby="cmp-audit" style={{ marginTop: 24 }}>
        <h3 id="cmp-audit">Audit log retention</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          The audit log keeps its own retention, set by whoever runs this deployment
          (<code>AUDIT_LOG_RETENTION_DAYS</code> on the builder API; unset keeps entries for good). It is
          not a Workspace setting on purpose: the admins it records should not be able to shorten it. Call
          retention above never deletes from it.
        </p>
      </section>

      {report && (
        <section aria-labelledby="cmp-agents" style={{ marginTop: 24 }}>
          <h3 id="cmp-agents">Where it applies</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Every agent is its own TurnCall project, so a save is written into each one. One that failed keeps
            its previous setting until it is written again.
          </p>
          {!report.complete && (
            <div className="callout warn" style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ flex: 1 }}>
                {failed ? "Some agents could not be written to." : "Some agents do not hold the current setting yet."}
              </span>
              <button className="btn" disabled={busy} onClick={apply}>
                {failed ? "Retry" : "Apply now"}
              </button>
            </div>
          )}
          <table className="list">
            <thead>
              <tr>
                <th>Agent</th>
                <th>State</th>
                <th>Setting</th>
              </tr>
            </thead>
            <tbody>
              {report.agents.map((a) => (
                <tr key={a.agent_id}>
                  <td>
                    <Link to={`/agents/${a.agent_id}/build/compliance`}>{a.name}</Link>
                  </td>
                  <td>
                    <ProjectionBadge projection={a} />
                    {a.error && <div className="error-text">{a.error}</div>}
                  </td>
                  <td className="hint">{a.overridden ? "Its own override" : "The Workspace's"}</td>
                </tr>
              ))}
              {report.webhook_numbers && (
                <tr>
                  <td>Custom call-init numbers</td>
                  <td>
                    <ProjectionBadge projection={report.webhook_numbers} />
                    {report.webhook_numbers.error && <div className="error-text">{report.webhook_numbers.error}</div>}
                  </td>
                  <td className="hint">The Workspace's</td>
                </tr>
              )}
              {report.agents.length === 0 && !report.webhook_numbers && (
                <tr>
                  <td colSpan={3} className="muted" style={{ padding: 16 }}>
                    No agents yet. A new agent starts with this setting.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

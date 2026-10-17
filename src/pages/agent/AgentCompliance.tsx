// An Agent's override of the Workspace's compliance settings (builder-api
// #103, ADR-0028). Any member reads what applies to the agent's calls; only an
// admin overrides it, since an override can weaken the Workspace's policy.
// Saved on its own, like Limits: it is the agent's TurnCall project setting,
// not part of its config.
import { useEffect, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { isAdmin } from "../../roles";
import { KINDS, describeDays, describeRedaction, entitiesOf, type AgentReport } from "../../compliance";
import {
  ProjectionBadge,
  RedactionEditor,
  RetentionEditor,
  redactionToSend,
  retentionForm,
  retentionToSend,
  useRun,
  type RedactionForm,
  type RetentionForm,
} from "../compliance/Fields";

export default function AgentCompliance({ agentId }: { agentId: string }) {
  const { activeWorkspace } = useAuth();
  const admin = isAdmin(activeWorkspace?.role);
  const [report, setReport] = useState<AgentReport | null>(null);
  const [overrideRedaction, setOverrideRedaction] = useState(false);
  const [redaction, setRedaction] = useState<RedactionForm>({ enabled: false, picked: [] });
  const [retention, setRetention] = useState<RetentionForm>(() => retentionForm(null, true));
  const { busy, error, notice, run, refuse } = useRun();
  const defaults = report?.entity_types.default ?? [];

  const take = (r: AgentReport) => {
    setReport(r);
    const own = r.override.redaction;
    setOverrideRedaction(own !== null);
    // Overriding starts from the Workspace's, so a switch to "override" is not
    // also a silent change of what is redacted.
    const start = own ?? r.workspace.redaction;
    setRedaction({ enabled: start.enabled, picked: entitiesOf(start, r.entity_types.default) });
    setRetention(retentionForm(r.override.retention, true));
  };

  useEffect(() => {
    api<{ data: AgentReport }>(`/agents/${agentId}/compliance`)
      .then((r) => take(r.data))
      .catch((e) => refuse(e instanceof Error ? e.message : "Could not load the compliance settings."));
  }, [agentId]);

  const save = () => {
    const red = overrideRedaction ? redactionToSend(redaction, defaults) : null;
    const ret = retentionToSend(retention, true);
    const invalid = red?.error ?? ret.error;
    if (invalid) return refuse(invalid);
    const anyRetention = KINDS.some((k) => ret.retention[k.key] !== null);
    const body = { redaction: red?.redaction ?? null, retention: anyRetention ? ret.retention : null };
    return run(async () => {
      const r = await api<{ data: AgentReport }>(`/agents/${agentId}/compliance`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      take(r.data);
      return r.data.projection.state === "applied"
        ? "Saved, and written into this agent."
        : "Saved, but not written into this agent yet; see below.";
    });
  };

  // This agent's projection alone; every other agent is left as it stands.
  const retry = () =>
    run(async () => {
      const r = await api<{ data: AgentReport }>(`/agents/${agentId}/compliance/apply`, { method: "POST" });
      take(r.data);
      const p = r.data.projection;
      return p.state === "applied"
        ? "Written into this agent's project now."
        : p.state === "failed"
          ? `Still could not be written: ${p.error ?? "unknown error"}`
          : "Not written into this agent's project yet.";
    });

  const loaded = report !== null;
  const disabled = !admin || !loaded || busy;
  const ws = report?.workspace;
  const own = report?.override;

  return (
    <section aria-labelledby="agc-h" className="wb-section">
      <h2 id="agc-h">Redaction and retention</h2>
      <p className="muted lead">
        This agent follows the Workspace's compliance settings unless it overrides them here.
        {!admin && " Only an admin can override them."}
      </p>
      <p className="hint">
        Redaction changes what is stored and sent after the call, never what the agent hears during it: the
        agent and its model always hear the caller. It covers text only; the recording is not redacted, so keep
        recordings short under Retention if they may hold personal details.
      </p>

      {report && (
        <div className="callout" aria-label="What applies">
          <strong>What applies to this agent's calls</strong>
          <p>
            Redaction: {describeRedaction(report.effective.redaction, defaults)}
            <span className="muted"> ({own?.redaction ? "this agent's" : "the Workspace's"})</span>
          </p>
          {KINDS.map((k) => (
            <p key={k.key} style={{ margin: "2px 0 0" }}>
              {k.label}: {describeDays(report.effective.retention[k.key])}
              <span className="muted">
                {" "}({own?.retention?.[k.key] != null ? "this agent's" : "the Workspace's"})
              </span>
            </p>
          ))}
          <p style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ProjectionBadge projection={report.projection} />
            {report.projection.state === "applied"
              ? "Written into this agent's project."
              : report.projection.state === "failed"
                ? `Could not be written: ${report.projection.error ?? "unknown error"}`
                : "Not written into this agent's project yet."}
            {admin && report.projection.state !== "applied" && (
              <button className="btn" disabled={busy} onClick={retry}>
                {report.projection.state === "failed" ? "Retry" : "Apply now"}
              </button>
            )}
          </p>
        </div>
      )}

      <h3>Redaction</h3>
      <div className="radio-row" role="radiogroup" aria-label="Redaction for this agent">
        <label>
          <input type="radio" name="agc-redaction" checked={!overrideRedaction} disabled={disabled}
            onChange={() => setOverrideRedaction(false)} />
          Use the Workspace's{ws ? `: ${describeRedaction(ws.redaction, defaults)}` : ""}
        </label>
        <label>
          <input type="radio" name="agc-redaction" checked={overrideRedaction} disabled={disabled}
            onChange={() => setOverrideRedaction(true)} />
          Override for this agent
        </label>
      </div>
      {overrideRedaction && (
        <RedactionEditor
          idPrefix="agc"
          value={redaction}
          onChange={setRedaction}
          supported={report?.entity_types.supported ?? []}
          defaults={defaults}
          disabled={disabled}
        />
      )}

      <h3>Retention</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Each kind on its own: a blank field takes the Workspace's.
      </p>
      <RetentionEditor
        idPrefix="agc"
        value={retention}
        onChange={setRetention}
        inherited={ws?.retention}
        disabled={disabled}
      />

      {admin && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button className="btn" disabled={!loaded || busy} onClick={save}>Save override</button>
        </div>
      )}
      {error && <p role="alert" className="error-text">{error}</p>}
      {notice && <p role="status" className="hint">{notice}</p>}
    </section>
  );
}

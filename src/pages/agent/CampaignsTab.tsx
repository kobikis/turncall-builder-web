// The agent's campaigns (#67): outbound calls to a list, dialled by TurnCall's
// campaign worker. One agent per campaign — weighted campaigns need agents
// that share a TurnCall project, and every builder agent is its own.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { fmtTime } from "../../dates";
import { canEdit } from "../../roles";
import { usePoll } from "../../usePoll";
import { useAgent } from "./AgentPage";
import { CampaignForm } from "./CampaignForm";
import { DoNotCallList } from "./Outbound";
import { Section } from "./Section";

type Campaign = {
  id: string;
  name: string;
  status: string;
  targets: Record<string, number>;
  created_at: string;
  timezone?: string | null;
};
type CampaignTarget = {
  id: string;
  number: string;
  status: string;
  attempts: number;
  call_id: string | null;
  ended_reason: string | null;
  error: string | null;
};

// TurnCall's target states (CampaignTargetStatus), grouped the way a person
// reads progress. A retry is a target back in `pending` with a dial behind it.
const GROUPS: [string, string[]][] = [
  ["pending", ["pending"]],
  ["calling", ["dialling", "placing", "calling"]],
  ["done", ["completed"]],
  ["failed", ["failed", "suppressed"]],
  ["cancelled", ["cancelled"]],
];
const LIVE = ["queued", "running", "paused"];

function progress(counts: Record<string, number>): string {
  return GROUPS.map(([label, statuses]) => [label, statuses.reduce((n, s) => n + (counts[s] ?? 0), 0)] as const)
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${n} ${label}`)
    .join(" · ") || "no targets";
}

const targetStatus = (t: CampaignTarget) => (t.status === "pending" && t.attempts > 0 ? "retrying" : t.status);

const statusBadge = (s: string) =>
  `badge ${s === "completed" || s === "running" ? "running" : s === "failed" || s === "cancelled" ? "failed" : ""}`;

export default function CampaignsTab() {
  const { agentId } = useAgent();
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{ data: Campaign[] }>(`/agents/${agentId}/campaigns`)
        .then((r) => {
          setCampaigns(r.data);
          setError("");
        })
        .catch((e) => setError(e.message)),
    [agentId],
  );
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 10000);

  if (openId) return <CampaignDetail agentId={agentId} campaignId={openId} editable={editable} onBack={() => { setOpenId(null); load(); }} />;
  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      {error && <p role="alert" className="error-text">{error}</p>}
      {editable && !creating && (
        <button className="btn btn-primary" style={{ marginBottom: 10 }} onClick={() => setCreating(true)}>+ New campaign</button>
      )}
      {creating && (
        <div style={{ marginBottom: 12 }}>
          <CampaignForm agentId={agentId} onClose={() => setCreating(false)}
            onCreated={(id) => { setCreating(false); setOpenId(id); }} />
        </div>
      )}
      <table className="list">
        <thead><tr><th>Name</th><th>Status</th><th>Progress</th><th>Created</th></tr></thead>
        <tbody>
          {(campaigns || []).map((c) => (
            <tr key={c.id} onClick={() => setOpenId(c.id)} style={{ cursor: "pointer" }}>
              <td><button className="row-toggle" onClick={() => setOpenId(c.id)}>{c.name}</button></td>
              <td><span className={statusBadge(c.status)}>{c.status}</span></td>
              <td className="hint">{progress(c.targets)}</td>
              <td className="num hint">{fmtTime(c.created_at)}</td>
            </tr>
          ))}
          {campaigns?.length === 0 && (
            <tr><td colSpan={4} className="muted" style={{ padding: 16 }}>No campaigns yet — one calls a list of numbers as this agent.</td></tr>
          )}
        </tbody>
      </table>
      <Section id="do-not-call" title="Do-not-call list" defaultOpen={false}>
        <DoNotCallList agentId={agentId} editable={editable} />
      </Section>
    </div>
  );
}

function CampaignDetail({ agentId, campaignId, editable, onBack }: {
  agentId: string; campaignId: string; editable: boolean; onBack: () => void;
}) {
  const base = `/agents/${agentId}/campaigns/${campaignId}`;
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, t] = await Promise.all([
        api<{ data: Campaign }>(base),
        api<{ data: CampaignTarget[]; total?: number }>(`${base}/targets${filter ? `?status=${encodeURIComponent(filter)}` : ""}`),
      ]);
      setCampaign(c.data);
      setTargets(t.data);
      setTotal(t.total ?? t.data.length);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the campaign.");
    }
  }, [base, filter]);
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 5000, !campaign || LIVE.includes(campaign.status));

  const act = async (action: "pause" | "resume" | "cancel") => {
    setError("");
    setConfirmCancel(false);
    try {
      await api(`${base}/${action}`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${action} the campaign.`);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <button className="btn" style={{ marginBottom: 10 }} onClick={onBack}>← Campaigns</button>
      {campaign && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{campaign.name}</h3>
          <span className={statusBadge(campaign.status)}>{campaign.status}</span>
          <span className="hint">{progress(campaign.targets)}</span>
          {editable && LIVE.includes(campaign.status) && (
            <>
              {campaign.status === "paused"
                ? <button className="btn" onClick={() => act("resume")}>Resume</button>
                : <button className="btn" onClick={() => act("pause")}>Pause</button>}
              {confirmCancel ? (
                <span className="callout warn" style={{ padding: "4px 8px" }}>
                  Cancel is final: targets not yet called never will be. Live calls stay up.{" "}
                  <button className="btn btn-danger" onClick={() => act("cancel")}>Yes, cancel it</button>{" "}
                  <button className="btn" onClick={() => setConfirmCancel(false)}>Keep it</button>
                </span>
              ) : (
                <button className="btn btn-danger" onClick={() => setConfirmCancel(true)}>Cancel campaign</button>
              )}
            </>
          )}
        </div>
      )}
      {campaign?.status === "paused" && <p className="hint">Paused: nothing new is dialled; calls already live stay up.</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      <div style={{ marginBottom: 8 }}>
        <select className="input" style={{ width: "auto" }} aria-label="Filter targets by status" value={filter}
          onChange={(e) => setFilter(e.target.value)}>
          <option value="">All targets</option>
          {Object.keys(campaign?.targets ?? {}).map((s) => (
            <option key={s} value={s}>{s} ({campaign!.targets[s]})</option>
          ))}
        </select>
      </div>
      <table className="list">
        <thead><tr><th>Number</th><th>Status</th><th>Calls</th><th>Outcome</th><th>Call</th></tr></thead>
        <tbody>
          {targets.map((t) => (
            <tr key={t.id}>
              <td className="num">{t.number}</td>
              <td><span className={statusBadge(t.status)}>{targetStatus(t)}</span></td>
              <td className="num">{t.attempts}</td>
              <td className="hint">{t.ended_reason ?? t.error ?? "—"}</td>
              <td>{t.call_id ? <Link to={`../calls?call=${t.call_id}`}>{t.call_id.slice(0, 8)}…</Link> : <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > targets.length && <p className="hint">Showing the first {targets.length} of {total}.</p>}
    </div>
  );
}

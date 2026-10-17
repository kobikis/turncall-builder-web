import { Fragment, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import Uid from "../components/Uid";
import { fmtStamp } from "../dates";
import type {
  AgentRef,
  ApiResponse,
  AuditChange,
  AuditChanges,
  AuditEntry,
  EngineLinkEntries,
  Member,
} from "../types";
import MembersNav from "./MembersNav";
import { dayRangeToQuery, isCompleteDay, MASK, pointerLabel, resourceLabel, validDay } from "./auditFormat";

const PAGE_SIZE = 50;
// How long a date field waits for the next keystroke before filtering.
const DATE_COMMIT_MS = 600;

type AuditPage = { success: boolean; data: AuditEntry[]; total: number; page: number; limit: number };

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

// Who changed what, and when (builder-api ADR-0028). Admin-only: the route is
// gated (RequireRole "admin") and the rail hides Members from anyone else; the
// server refuses the read to an editor or viewer regardless.
//
// The filters live in the URL, so a filtered view survives a reload and can be
// pasted to another admin. The API pages and filters; this page only asks.
export default function AuditLog() {
  const [params, setParams] = useSearchParams();
  const member = params.get("member") ?? "";
  const agent = params.get("agent") ?? "";
  // A pasted or hand-edited link may hold anything: a value that is not a day
  // is no filter, and a page that is not a whole number from 1 is page 1.
  const from = validDay(params.get("from"));
  const to = validDay(params.get("to"));
  const asked = Math.floor(Number(params.get("page")));
  const page = Number.isSafeInteger(asked) && asked >= 1 ? asked : 1;

  // The page asked for rides along, so a stale answer is never taken for this page's.
  const [result, setResult] = useState<(AuditPage & { asked: number }) | null>(null); // null = loading
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // For the pickers and to name an entry's agents. Not fatal when they fail:
  // the log still reads, by id.
  const [members, setMembers] = useState<Member[]>([]);
  const [agents, setAgents] = useState<AgentRef[]>([]);

  useEffect(() => {
    api<ApiResponse<{ members: Member[] }>>("/members")
      .then((r) => setMembers(r.data.members))
      .catch(() => {});
    api<ApiResponse<{ agents: AgentRef[] }>>("/agents")
      .then((r) => setAgents(r.data.agents))
      .catch(() => {});
  }, []);

  const query = new URLSearchParams({
    ...(member ? { member } : {}),
    ...(agent ? { agent } : {}),
    ...dayRangeToQuery(from, to),
    page: String(page),
    limit: String(PAGE_SIZE),
  }).toString();

  useEffect(() => {
    let live = true;
    setResult(null);
    setError(null);
    api<AuditPage>(`/audit?${query}`)
      .then((r) => live && setResult({ ...r, asked: page }))
      .catch((e) => live && setError(errMsg(e, "Could not load the audit log")));
    return () => {
      live = false;
    };
  }, [query]); // `query` holds `page`

  // Past the last page (a bookmark from when there were more entries, or a
  // narrower filter): go to the last one there is, in place of this one.
  const lastPage = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const beyond = result !== null && result.asked === page && page > lastPage;
  useEffect(() => {
    if (beyond) goTo(lastPage, true);
  }, [beyond, lastPage]);

  // Any filter change starts again at page 1; paging keeps the filters.
  function setFilter(name: "member" | "agent" | "from" | "to", value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("page");
    setParams(next);
    setOpenId(null);
  }
  function goTo(p: number, replace = false) {
    const next = new URLSearchParams(params);
    if (p > 1) next.set("page", String(p));
    else next.delete("page");
    setParams(next, { replace });
    setOpenId(null);
  }

  const agentName = (id: string) => agents.find((a) => a.agent_id === id)?.name;
  const entries = beyond ? [] : (result?.data ?? []);
  const total = result?.total ?? 0;
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const filtered = Boolean(member || agent || from || to);
  // A removed member's entries outlive them; keep a pasted filter selectable.
  const memberGone = member && !members.some((m) => m.user_id === member);
  const agentGone = agent && !agents.some((a) => a.agent_id === agent);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Members</h1>
        <MembersNav />
      </div>
      <p className="muted audit-intro">
        Every change a member made in this workspace: who, under which role, what changed, and when. Secrets read as
        hidden — the log records that one changed, never its value.
      </p>

      <div className="audit-filters">
        <select className="input" aria-label="Filter by member" value={member} onChange={(e) => setFilter("member", e.target.value)}>
          <option value="">All members</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.email}
            </option>
          ))}
          {memberGone && <option value={member}>Former member ({member.slice(0, 8)})</option>}
        </select>
        <select className="input" aria-label="Filter by agent" value={agent} onChange={(e) => setFilter("agent", e.target.value)}>
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.agent_id} value={a.agent_id}>
              {a.name}
            </option>
          ))}
          {agentGone && <option value={agent}>Deleted agent ({agent.slice(0, 8)})</option>}
        </select>
        <DayInput label="From date" value={from} max={to} onCommit={(v) => setFilter("from", v)} />
        <span className="muted">→</span>
        <DayInput label="To date" value={to} min={from} onCommit={(v) => setFilter("to", v)} />
        {filtered && (
          <button className="btn" type="button" style={{ padding: "3px 10px" }} onClick={() => setParams(new URLSearchParams())}>
            clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="callout error" role="alert">
          {error}
        </div>
      )}

      <table className="list">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>What</th>
            <th>Agents</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <EntryRows
              key={e.id}
              entry={e}
              open={openId === e.id}
              onToggle={() => setOpenId(openId === e.id ? null : e.id)}
              agentName={agentName}
            />
          ))}
          {(result === null || beyond) && !error && (
            <tr>
              <td colSpan={4} className="muted" style={{ padding: 16 }}>
                Loading…
              </td>
            </tr>
          )}
          {result && !beyond && entries.length === 0 && (
            <tr>
              <td colSpan={4} className="muted" style={{ padding: 16 }}>
                {filtered ? "No entries match these filters." : "Nothing recorded yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {result && !beyond && total > 0 && (
        <div className="audit-pager">
          <span className="muted num">
            {first}–{last} of {total}
          </span>
          <button className="btn" type="button" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            ← Newer
          </button>
          <button className="btn" type="button" disabled={last >= total} onClick={() => goTo(page + 1)}>
            Older →
          </button>
        </div>
      )}
    </div>
  );
}

/** A date filter that sends a day once it is whole: on leaving the field, on
 *  Enter, or after a pause in typing. Each keystroke alone sends nothing, so
 *  typing a year never asks the API for 0020 on the way to 2026. */
function DayInput({ label, value, min, max, onCommit }: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onCommit: (day: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  // The URL changed under it (clear filters, back): show what applies.
  useEffect(() => setDraft(value), [value]);
  const pending = draft !== value && isCompleteDay(draft);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => commitRef.current(draft), DATE_COMMIT_MS);
    return () => clearTimeout(t);
  }, [pending, draft]);
  const commit = () => {
    if (pending) commitRef.current(draft);
  };
  return (
    <input
      type="date"
      className="input"
      aria-label={label}
      value={draft}
      min={min || undefined}
      max={max || undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

function EntryRows(props: {
  entry: AuditEntry;
  open: boolean;
  onToggle: () => void;
  agentName: (id: string) => string | undefined;
}) {
  const { entry: e, open, onToggle, agentName } = props;
  const partial = e.outcome === "partial";
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td className="num nowrap">
          <button
            className="row-toggle"
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} entry from ${fmtStamp(e.created_at)}`}
            title={e.created_at}
            onClick={(ev) => {
              ev.stopPropagation();
              onToggle();
            }}
          >
            <span className="caret" aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
            {fmtStamp(e.created_at)}
          </button>
        </td>
        <td>
          {e.user_email || <Uid id={e.user_id} label="user_id" />}{" "}
          <span className="hint">as {e.role}</span>
        </td>
        <td>
          <span className="audit-action">{e.action}</span> <span className="muted">{resourceLabel(e.resource_type)}</span>{" "}
          {e.resource_name ? <strong>{e.resource_name}</strong> : <Uid id={e.resource_id} label="resource_id" />}
          {partial && (
            <>
              {" "}
              <span className="badge degraded" title="It failed after some of it had landed">
                partial
              </span>
              {e.error && <div className="error-text">{e.error}</div>}
            </>
          )}
        </td>
        <td>
          {e.agent_ids.length === 0 ? (
            <span className="muted">—</span>
          ) : (
            e.agent_ids.map((id, i) => (
              <Fragment key={id}>
                {i > 0 && ", "}
                {agentName(id) ?? <Uid id={id} label="agent_id" />}
              </Fragment>
            ))
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="audit-drawer">
            <EntryDetail entry={e} />
          </td>
        </tr>
      )}
    </>
  );
}

function EntryDetail({ entry: e }: { entry: AuditEntry }) {
  return (
    <div>
      {e.outcome === "partial" && (
        <div className="callout warn">
          <strong>Only part of this change landed.</strong> {e.error || "No reason was recorded."}
        </div>
      )}
      <div className="audit-meta hint">
        {resourceLabel(e.resource_type)} <Uid id={e.resource_id} label="resource_id" /> · request{" "}
        <Uid id={e.request_id} label="request_id" />
      </div>
      <ChangesTable changes={e.changes} />
      <EngineEntries entry={e} />
    </div>
  );
}

function ChangesTable({ changes }: { changes: AuditChanges | undefined }) {
  const rows = Object.entries(changes ?? {});
  if (rows.length === 0) return <p className="muted">No field changes recorded.</p>;
  return (
    <div className="table-scroll">
      <table className="list audit-diff">
        <thead>
          <tr>
            <th>Field</th>
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([pointer, c]) => (
            <tr key={pointer}>
              <td>
                <code title={pointer}>{pointerLabel(pointer)}</code>
              </td>
              <td className="audit-before">{c.before_unknown ? <Unknown /> : <Value v={c.before} change={c} />}</td>
              <td className="audit-after">
                <Value v={c.after} change={c} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Unknown = () => (
  <em className="muted" title="Its previous value was never read, so it is not known">
    unknown
  </em>
);

function Value({ v, change }: { v: unknown; change: AuditChange }) {
  if (v === null || v === undefined) return <span className="muted" title="unset">—</span>;
  // The API marks a masked secret itself; the text alone is not proof.
  if (change.secret)
    return (
      <span className="chip audit-secret" title="A secret: the log records that it changed, never its value">
        hidden
      </span>
    );
  // An entry from before that mark (or one of TurnCall's): `***` was most
  // likely a secret, but could be the text itself. Say neither.
  if (v === MASK && change.secret === undefined)
    return (
      <span className="audit-value" title="Masked, or the text *** itself: this entry predates marking secrets">
        {MASK}
      </span>
    );
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return <span className="audit-value">{text}</span>;
}

// TurnCall's own record of the change, read on demand: one request to the
// builder, which reads each linked project's log with that project's key (the
// key never reaches the console). A link it can't read says why; the rest show.
function EngineEntries({ entry: e }: { entry: AuditEntry }) {
  const [links, setLinks] = useState<EngineLinkEntries[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (e.engine_links.length === 0)
    return <p className="hint">This change did not reach TurnCall, or TurnCall does not audit it.</p>;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api<ApiResponse<EngineLinkEntries[]>>(`/audit/${e.id}/engine`);
      setLinks(r.data);
    } catch (err) {
      setError(errMsg(err, "Could not read TurnCall's entries"));
    } finally {
      setLoading(false);
    }
  }

  const n = e.engine_links.length;
  return (
    <section className="audit-engine">
      <h3>In TurnCall</h3>
      {links === null ? (
        <button className="btn" type="button" disabled={loading} onClick={() => void load()}>
          {loading ? "Loading…" : `Show TurnCall's entries (${n} request${n === 1 ? "" : "s"})`}
        </button>
      ) : (
        links.map((l, i) => (
          <div key={`${l.engine_audit_id}-${i}`} className="audit-engine-link">
            <div className="hint">
              Project <Uid id={l.project_id} label="project_id" /> · TurnCall request{" "}
              <Uid id={l.engine_audit_id} label="engine_audit_id" />
            </div>
            {l.entries === null ? (
              <div className="callout warn">Can't read these entries: {l.error || "unknown reason"}</div>
            ) : l.entries.length === 0 ? (
              <p className="muted">TurnCall recorded nothing for this request.</p>
            ) : (
              l.entries.map((x) => (
                <div key={x.id} className="audit-engine-entry">
                  <div>
                    <span className="audit-action">{x.action}</span>{" "}
                    <span className="muted">{resourceLabel(x.resource_type)}</span>{" "}
                    <Uid id={x.resource_id} label="resource_id" />
                    {x.actor && <span className="hint"> by {x.actor === "platform" ? "the platform" : "API key"}</span>}
                    {x.created_at && <span className="hint"> · {fmtStamp(x.created_at)}</span>}
                  </div>
                  <ChangesTable changes={x.changes} />
                </div>
              ))
            )}
          </div>
        ))
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </section>
  );
}

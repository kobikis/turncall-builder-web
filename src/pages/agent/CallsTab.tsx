import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import Uid from "../../components/Uid";
import { usePoll } from "../../usePoll";
import { useAgent } from "./AgentPage";
import { Call } from "../../types";
import { fmtTime, inDayRange, localDay } from "../../dates";
import { fmtDuration } from "./callDetail";
import CallDrawer from "./CallDrawer";

// Long enough for a busy container, short enough that a stuck one is reported
// before the next tick rather than never.
const POLL_TIMEOUT_MS = 5000;

// One call's events, as the agent's backend received them: the open call, else
// the newest. Events with no call (a call refused over the limit, chat
// sessions) are not shown here.
export function EventsFeed({ browserUrl, callId }: { browserUrl: string; callId: string | null }) {
  const [events, setEvents] = useState<any[]>([]);
  const [pollError, setPollError] = useState(false);
  const fails = useRef(0);

  const poll = useCallback(async () => {
    if (!callId) return;
    try {
      // A timeout, because the API relays this to the agent's backend
      // (browser_url is that relay). A backend that accepts the connection and
      // never answers — one starting, wedged, or paused — leaves the promise
      // pending forever, `usePoll` never starts another (its in-flight guard
      // is doing its job), and the feed stops for good: no new events, no
      // error, because the catch below never runs. api(), not fetch: the relay
      // is a builder route, scoped by the workspace header like the rest.
      const body = await api(`${browserUrl}/events?call_id=${encodeURIComponent(callId)}`, {
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      });
      setEvents(body.data.events);
      setPollError(false);
      fails.current = 0;
    } catch {
      // Two consecutive misses before flagging — one blip isn't "container down".
      fails.current += 1;
      if (fails.current >= 2) setPollError(true);
    }
  }, [browserUrl, callId]);
  useEffect(() => {
    poll();
  }, [poll]);
  usePoll(poll, 10000); // visibility-paused, non-overlapping (no stacked retries)

  // A backend generated before `?call_id=` existed answers every event.
  const shown = events.filter((e) => e.call_id === callId);
  return (
    <div className="card" style={{ flex: 1, overflowY: "auto", padding: "6px 12px" }}>
      {pollError && (
        <p role="alert" className="error-text">
          Can't reach this agent's backend. Is it running?
        </p>
      )}
      {!callId && <p className="muted">No calls yet.</p>}
      {callId && !pollError && shown.length === 0 && <p className="muted">Waiting for this call's events…</p>}
      {shown.map((e, i) => (
        <details key={e.event_id ?? i} className="event-row">
          <summary>
            <span className="muted">{e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : ""}</span>
            <code>{e.event}</code>
          </summary>
          <pre className="event-data">{JSON.stringify(e, null, 2)}</pre>
        </details>
      ))}
    </div>
  );
}

export default function CallsTab() {
  const { agentId, data } = useAgent();
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [error, setError] = useState("");
  // ?call=<id> (a campaign target's link) opens on that call, whatever its day.
  const linked = new URLSearchParams(window.location.search).get("call");
  const [openId, setOpenId] = useState<string | null>(linked);
  const [q, setQ] = useState(linked ?? "");
  // Date range defaults to today (local); inclusive, "" = open bound.
  const today = localDay(new Date().toISOString());
  const [from, setFrom] = useState(linked ? "" : today);
  const [to, setTo] = useState(linked ? "" : today);
  const [sortDesc, setSortDesc] = useState(true); // newest first by default

  const load = useCallback(
    () =>
      api(`/agents/${agentId}/calls`)
        .then(async (r) => {
          // A linked call older than the first page is fetched on its own.
          const linkedCall =
            linked && !r.data.some((c: Call) => c.id === linked)
              ? await api(`/agents/${agentId}/calls/${linked}`).then((one) => one.data).catch(() => null)
              : null;
          setCalls(linkedCall ? [linkedCall, ...r.data] : r.data);
          setError("");
        })
        .catch((e) => setError(e.message)),
    [agentId, linked]
  );
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 10000); // visibility-paused, non-overlapping

  // Filter by uid (text) + an inclusive date range (from/to), then sort by time.
  const visible = (calls || [])
    .filter((c) => {
      if (!inDayRange(c.started_at, from, to)) return false;
      const s = q.trim().toLowerCase();
      return !s || c.id.toLowerCase().includes(s);
    })
    .sort((a, b) => {
      const d = (a.started_at ? Date.parse(a.started_at) : 0) - (b.started_at ? Date.parse(b.started_at) : 0);
      return sortDesc ? -d : d;
    });

  // The feed follows the open call; with none open, the newest one — the call
  // that is live, when one is.
  const at = (c: Call) => Date.parse(c.started_at ?? "") || 0;
  const newest = (calls || []).reduce<Call | null>(
    (a, c) => (!a || at(c) > at(a) ? c : a),
    null
  );
  const feedCallId = openId ?? newest?.id ?? null;

  return (
    <div style={{ display: "flex", gap: 20, flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
        {error && <p role="alert" className="error-text">{error}</p>}
        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 200, maxWidth: 320 }}
            aria-label="Search calls by id"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by call id (e.g. 3f2a…)"
          />
          <input
            type="date"
            className="input"
            style={{ width: "auto" }}
            aria-label="Calls from date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span className="muted">→</span>
          <input
            type="date"
            className="input"
            style={{ width: "auto" }}
            aria-label="Calls to date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
          {(from || to) && (
            <button className="btn" style={{ padding: "3px 10px" }} onClick={() => { setFrom(""); setTo(""); }}>
              clear dates
            </button>
          )}
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>
                <button
                  className="row-toggle"
                  onClick={() => setSortDesc((v) => !v)}
                  aria-label={`Sort by time, ${sortDesc ? "newest" : "oldest"} first — click to reverse`}
                >
                  Time <span className="caret" aria-hidden="true">{sortDesc ? "▾" : "▴"}</span>
                </button>
              </th>
              <th>ID</th><th>Direction</th><th>From → To</th><th>Status</th><th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <CallRows key={c.id} call={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} agentId={agentId} />
            ))}
            {calls === null && !error && (
              <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>Loading…</td></tr>
            )}
            {calls?.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>No calls yet — dial a bound number or connect via WebRTC.</td></tr>
            )}
            {calls && calls.length > 0 && visible.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>No calls match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ width: 300, display: "flex", flexDirection: "column" }}>
        <h3>
          Live events{" "}
          {feedCallId && (
            <span className="muted" style={{ fontWeight: "normal", fontSize: "0.8em" }}>
              {openId ? "call" : "latest call"} <Uid id={feedCallId} label="call_id" />
            </span>
          )}
        </h3>
        {data.backend?.browser_url ? (
          <EventsFeed browserUrl={data.backend.browser_url} callId={feedCallId} />
        ) : (
          <p className="muted">No backend.</p>
        )}
      </div>
    </div>
  );
}

function CallRows(props: { call: Call; open: boolean; onToggle: () => void; agentId: string }) {
  const { call: c, open, onToggle, agentId } = props;
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td className="num">
          {/* Real button so keyboard + screen-reader users can open the drawer;
              row onClick stays as a mouse convenience. */}
          <button
            className="row-toggle"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} call from ${fmtTime(c.started_at)}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <span className="caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
            {fmtTime(c.started_at)}
          </button>
        </td>
        <td onClick={(e) => e.stopPropagation()}><Uid id={c.id} label="call_id" /></td>
        <td>{c.direction}</td>
    <td className="num hint">
          {c.from_number || c.to_number ? (
            <>{c.from_number || "—"} → {c.to_number || "—"}</>
          ) : c.provider_call_sid === "webrtc" ? (
            <span className="muted">WebRTC session</span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td><span className={`badge ${c.status === "completed" ? "running" : c.status === "failed" ? "failed" : ""}`}>{c.status}</span></td>
        <td className="num">{fmtDuration(c.duration_ms)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ padding: 0 }}>
            <CallDrawer agentId={agentId} call={c} />
          </td>
        </tr>
      )}
    </>
  );
}

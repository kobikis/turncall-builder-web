import { useCallback, useEffect, useRef, useState } from "react";
import { api, getActiveWorkspaceId } from "../../api";
import Uid from "../../components/Uid";
import { usePoll } from "../../usePoll";
import { useAgent } from "./AgentPage";
import { Call } from "../../types";
import SaveAsScenario from "./SaveAsScenario";
import { fmtTime, inDayRange, localDay } from "../../dates";
import { endedReasonLabel, offsetLabel } from "./callDetail";

type TranscriptEntry = { role: string | null; text: string; timestamp?: string };

const fmtDuration = (ms: number | null) => {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// A bare <audio src> can't attach X-Workspace-Id (RBAC gate → 400), so fetch
// the WAV with the header via the api() bypass helper and play a blob URL.
function RecordingPlayer({ agentId, callId }: { agentId: string; callId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const ws = getActiveWorkspaceId();
        const r = await fetch(`/api/agents/${agentId}/calls/${callId}/recording`, {
          credentials: "same-origin",
          headers: ws ? { "X-Workspace-Id": ws } : {},
        });
        if (!r.ok) throw new Error(`recording ${r.status}`);
        const blob = await r.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      } catch {
        if (!cancelled) setErr("Couldn't load the recording.");
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [agentId, callId]);

  if (err) return <p className="error-text">{err}</p>;
  if (!src) return <p className="muted">Loading recording…</p>;
  return <audio controls src={src} style={{ width: "100%", marginBottom: 10 }} />;
}

function CallDrawer({ agentId, call }: { agentId: string; call: Call }) {
  const [transcript, setTranscript] = useState<TranscriptEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/agents/${agentId}/calls/${call.id}/transcript`)
      .then((r) => setTranscript(r.data.entries || []))
      .catch((e) => setError(e.message));
  }, [agentId, call.id]);

  const analysis = call.analysis;
  const ended = endedReasonLabel(call.ended_reason);
  return (
    <div className="call-drawer">
      {(ended || call.agent_name) && (
        <div className="call-header">
          {ended && <span className="badge">{ended}</span>}
          {call.agent_name && (
            <span className="muted">
              Agent: <strong>{call.agent_name}</strong>
              {call.agent_version != null && <span className="badge version">v{call.agent_version}</span>}
            </span>
          )}
        </div>
      )}
      {call.recording_status === "completed" && (
        <>
          <h3>Recording</h3>
          <RecordingPlayer agentId={agentId} callId={call.id} />
        </>
      )}
      <h3>Transcript</h3>
      {error && <p className="error-text">{error}</p>}
      {transcript === null && !error && <p className="muted">Loading…</p>}
      {transcript?.length === 0 && <p className="muted">No transcript recorded.</p>}
      {transcript && transcript.length > 0 && (
        <div className="transcript">
          {transcript.map((t, i) => {
            const isCaller = t.role === "customer" || t.role === "user";
            const offset = offsetLabel(t.timestamp, call.started_at);
            return (
              <div key={i} className={`row ${isCaller ? "user" : "assistant"}`} style={{ display: "flex", flexDirection: "column", margin: "6px 0", alignItems: isCaller ? "flex-end" : "flex-start" }}>
                <span className="bubble">{t.text}</span>
                {offset && <span className="offset">{offset}</span>}
              </div>
            );
          })}
        </div>
      )}
      {/* The loop the Evals tab's empty state points at: a call that went
          wrong becomes a scenario that checks it never does again (#17). */}
      <SaveAsScenario agentId={agentId} callId={call.id} />

      <h3>Analysis</h3>
      {!analysis && <p className="muted">No analysis for this call.</p>}
      {analysis && (
        <dl>
          {Object.entries(analysis)
            .filter(([k]) => k !== "takeaways")
            .map(([k, v]) => (
              <FragmentRow key={k} k={k} v={v} />
            ))}
        </dl>
      )}
      {analysis?.takeaways != null && (
        <>
          <h3 style={{ marginTop: 12 }}>Takeaways</h3>
          {Object.entries(analysis.takeaways as Record<string, any>).map(([name, t]) => (
            <div key={name} className="search-result">
              <div className="score">
                <code>{name}</code>
                {t?.valid === false && <span style={{ marginLeft: 8 }} className="error-text">extraction failed</span>}
              </div>
              <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", fontSize: 12 }}>
                {JSON.stringify(t?.result ?? t?.error ?? t, null, 2)}
              </pre>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function FragmentRow({ k, v }: { k: string; v: unknown }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{typeof v === "string" ? v : JSON.stringify(v)}</dd>
    </>
  );
}

// Long enough for a busy container, short enough that a stuck one is reported
// before the next tick rather than never.
const POLL_TIMEOUT_MS = 5000;

function EventsFeed({ browserUrl }: { browserUrl: string }) {
  const [events, setEvents] = useState<any[]>([]);
  const [pollError, setPollError] = useState(false);
  const fails = useRef(0);

  const poll = useCallback(async () => {
    try {
      // A timeout, because this one goes straight to the agent's container
      // rather than through the proxy. A container that accepts the connection
      // and never answers — one starting, wedged, or paused — leaves the
      // promise pending forever, `usePoll` never starts another (its in-flight
      // guard is doing its job), and the feed stops for good: no new events,
      // no error, because the catch below never runs.
      const r = await fetch(`${browserUrl}/events`, {
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`events ${r.status}`);
      const body = await r.json();
      setEvents(body.data.events);
      setPollError(false);
      fails.current = 0;
    } catch {
      // Two consecutive misses before flagging — one blip isn't "container down".
      fails.current += 1;
      if (fails.current >= 2) setPollError(true);
    }
  }, [browserUrl]);
  useEffect(() => {
    poll();
  }, [poll]);
  usePoll(poll, 10000); // visibility-paused, non-overlapping (no stacked retries)

  return (
    <div className="card" style={{ flex: 1, overflowY: "auto", padding: "6px 12px" }}>
      {pollError && (
        <p role="alert" className="error-text">
          Can't reach the backend at {browserUrl}. Is its container running?
        </p>
      )}
      {!pollError && events.length === 0 && <p className="muted">Waiting for call events…</p>}
      {events.map((e, i) => (
        <div key={i} className="event-row">
          <code>{e.event}</code>
          <span className="muted">{e.call_id || "—"}</span>
        </div>
      ))}
    </div>
  );
}

export default function CallsTab() {
  const { agentId, data } = useAgent();
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // Date range defaults to today (local); inclusive, "" = open bound.
  const today = localDay(new Date().toISOString());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [sortDesc, setSortDesc] = useState(true); // newest first by default

  const load = useCallback(
    () =>
      api(`/agents/${agentId}/calls`)
        .then((r) => {
          setCalls(r.data);
          setError("");
        })
        .catch((e) => setError(e.message)),
    [agentId]
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
        <h3>Live events</h3>
        {data.backend?.browser_url ? (
          <EventsFeed browserUrl={data.backend.browser_url} />
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

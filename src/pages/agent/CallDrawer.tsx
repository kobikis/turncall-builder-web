import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { Call } from "../../types";
import SaveAsScenario from "./SaveAsScenario";
import { Section } from "./Section";
import RecordingTimeline from "./RecordingTimeline";
import LatencySection from "./LatencySection";
import TranscriptView from "./TranscriptView";
import {
  ToolInvocation,
  TranscriptEntry,
  endedReasonLabel,
  endedReasonTone,
  fmtDuration,
  timeline,
} from "./callDetail";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The expanded call: each part a section the reader can fold away, and the
 * choice remembered, so someone who never reads latency stops scrolling past it. */
export default function CallDrawer({ agentId, call }: { agentId: string; call: Call }) {
  const [transcript, setTranscript] = useState<TranscriptEntry[] | null>(null);
  const [tools, setTools] = useState<ToolInvocation[]>([]);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const hasRecording = call.recording_status === "completed";

  useEffect(() => {
    api(`/agents/${agentId}/calls/${call.id}/transcript`)
      .then((r) => setTranscript(r.data.entries || []))
      .catch((e) => setError(e.message));
    // Optional: a transcript without its tool calls is still a transcript.
    api(`/agents/${agentId}/calls/${call.id}/tool-invocations`)
      .then((r) => setTools(Array.isArray(r.data) ? r.data : []))
      .catch(() => setTools([]));
  }, [agentId, call.id]);

  const items = useMemo(() => timeline(transcript ?? [], tools), [transcript, tools]);
  const ended = endedReasonLabel(call.ended_reason);
  const tone = endedReasonTone(call.ended_reason);
  const analysis = call.analysis;
  const takeaways = analysis?.takeaways as Record<string, any> | undefined;
  const latency = call.latency_summary;

  return (
    <div className="call-drawer">
      {(ended || call.agent_name) && (
        <div className="call-header">
          {ended && <span className={`badge ${tone === "good" ? "running" : "failed"}`}>{ended}</span>}
          {call.agent_name && (
            <span className="muted">
              Agent: <strong>{call.agent_name}</strong>
              {call.agent_version != null && <span className="version-tag">v{call.agent_version}</span>}
            </span>
          )}
        </div>
      )}

      {hasRecording && (
        <Section id="call.recording" title="Recording" hint={fmtDuration(call.duration_ms)}>
          <RecordingTimeline agentId={agentId} callId={call.id} audioRef={audioRef} />
        </Section>
      )}

      <Section
        id="call.transcript"
        title="Transcript"
        hint={
          transcript
            ? [plural(transcript.length, "line"), tools.length > 0 && plural(tools.length, "tool call")]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
      >
        {error && <p className="error-text">{error}</p>}
        {transcript === null && !error && <p className="muted">Loading…</p>}
        {transcript?.length === 0 && tools.length === 0 && <p className="muted">No transcript recorded.</p>}
        {items.length > 0 && (
          <TranscriptView items={items} startedAt={call.started_at} audioRef={audioRef} canSeek={hasRecording} />
        )}
        {/* The loop the Evals tab's empty state points at: a call that went
            wrong becomes a scenario that checks it never does again (#17). */}
        <SaveAsScenario agentId={agentId} callId={call.id} />
      </Section>

      <Section
        id="call.latency"
        title="Latency"
        hint={latency ? `${plural(latency.turns, "turn")} · p50 ${latency.user_to_bot.p50_ms} ms` : "not measured"}
      >
        <LatencySection agentId={agentId} call={call} />
      </Section>

      <Section id="call.analysis" title="Analysis" hint={analysis ? undefined : "none"}>
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
      </Section>

      {takeaways != null && (
        <Section id="call.takeaways" title="Takeaways" hint={Object.keys(takeaways).length}>
          {Object.entries(takeaways).map(([name, t]) => (
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
        </Section>
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

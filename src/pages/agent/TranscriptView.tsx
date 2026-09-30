import { RefObject } from "react";
import {
  TimelineItem,
  ToolInvocation,
  TranscriptEntry,
  offsetLabel,
  offsetSeconds,
  prettyJson,
} from "./callDetail";

const fmtLatency = (ms: number | null) =>
  ms == null ? null : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

function Line(props: {
  entry: TranscriptEntry;
  startedAt: string | null;
  audioRef: RefObject<HTMLAudioElement>;
  canSeek: boolean;
}) {
  const { entry, startedAt, audioRef, canSeek } = props;
  const isCaller = entry.role === "customer" || entry.role === "user";
  const offset = offsetLabel(entry.timestamp, startedAt);
  const secs = offsetSeconds(entry.timestamp, startedAt);
  const seek = () => {
    if (audioRef.current && secs != null) audioRef.current.currentTime = secs;
  };
  return (
    <div className={`row ${isCaller ? "user" : "assistant"}`}>
      {canSeek && secs != null ? (
        <button className="bubble seekable" onClick={seek} title="Play from here">
          {entry.text}
        </button>
      ) : (
        <span className="bubble">{entry.text}</span>
      )}
      {offset && <span className="offset">{offset}</span>}
    </div>
  );
}

/** A tool the agent ran, in its own colour among the lines; opening it shows
 * what went in and what came back. */
function ToolCall({ tool, at, startedAt }: { tool: ToolInvocation; at: string; startedAt: string | null }) {
  const failed = tool.status !== "succeeded";
  const offset = offsetLabel(at, startedAt);
  const latency = fmtLatency(tool.latency_ms);
  return (
    <div className="row tool">
      <details className={`tool-call${failed ? " failed" : ""}`}>
        <summary>
          <svg className="tool-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10.6 1.5a3.6 3.6 0 0 0-3.4 4.8L1.9 11.6a1.4 1.4 0 0 0 2 2l5.3-5.3a3.6 3.6 0 0 0 4.8-3.4l-2 2-1.9-.5-.5-1.9 2-2z" />
          </svg>
          <span className="tool-name">{tool.tool_name}</span>
          <span className="tool-meta">
            {failed ? tool.status.replace(/_/g, " ") : "succeeded"}
            {latency && ` · ${latency}`}
          </span>
        </summary>
        <div className="tool-body">
          <span className="tool-label">Input</span>
          <pre>{prettyJson(tool.input_json)}</pre>
          <span className="tool-label">Output</span>
          <pre>{prettyJson(tool.output_json)}</pre>
        </div>
      </details>
      {offset && <span className="offset">{offset}</span>}
    </div>
  );
}

export default function TranscriptView(props: {
  items: TimelineItem[];
  startedAt: string | null;
  audioRef: RefObject<HTMLAudioElement>;
  canSeek: boolean;
}) {
  const { items, startedAt, audioRef, canSeek } = props;
  return (
    <div className="transcript">
      {items.map((item, i) =>
        item.kind === "tool" ? (
          <ToolCall key={`t-${item.tool.id}`} tool={item.tool} at={item.at} startedAt={startedAt} />
        ) : (
          <Line key={i} entry={item.entry} startedAt={startedAt} audioRef={audioRef} canSeek={canSeek} />
        )
      )}
    </div>
  );
}

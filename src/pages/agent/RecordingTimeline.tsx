import { RefObject, useEffect, useState } from "react";
import { getActiveWorkspaceId } from "../../api";
import { peaks, tracksOf, Track } from "./callDetail";

const BARS = 240;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

const fmtClock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Decoded in the browser with the Web Audio API — no library. An empty list
 * when the browser can't (no AudioContext): the recording still plays. */
async function decodeChannels(buf: ArrayBuffer): Promise<Float32Array[]> {
  const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctx) return [];
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buf);
    return Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  } finally {
    ctx.close?.();
  }
}

function Waveform(props: { track: Track; progress: number; onSeek: (fraction: number) => void }) {
  const { track, progress, onSeek } = props;
  const bars = peaks(track.samples, BARS);
  const kind = track.label.toLowerCase();
  return (
    <div className={`wave-track ${kind}`}>
      <span className="wave-label">{track.label}</span>
      <svg
        role="slider"
        aria-label={`${track.label} waveform — click to seek`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={-1}
        viewBox={`0 0 ${bars.length} 100`}
        preserveAspectRatio="none"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          if (box.width > 0) onSeek((e.clientX - box.left) / box.width);
        }}
      >
        {bars.map((p, i) => {
          const h = Math.max(1, p * 100);
          return <rect key={i} x={i + 0.15} width={0.7} y={50 - h / 2} height={h} />;
        })}
        <line className="playhead" x1={progress * bars.length} x2={progress * bars.length} y1={0} y2={100} />
      </svg>
    </div>
  );
}

/** The call's recording: caller and agent drawn as two waveforms (turncall
 * #178), a playhead, speed, download. `audioRef` is shared with the transcript
 * so an entry can seek here. */
export default function RecordingTimeline(props: {
  agentId: string;
  callId: string;
  audioRef: RefObject<HTMLAudioElement>;
}) {
  const { agentId, callId, audioRef } = props;
  const [src, setSrc] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [err, setErr] = useState("");
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        // A bare <audio src> can't attach X-Workspace-Id (RBAC gate → 400), so
        // fetch the WAV with the header and play a blob URL.
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
        const channels = await decodeChannels(await blob.arrayBuffer()).catch(() => []);
        if (!cancelled) setTracks(tracksOf(channels));
      } catch {
        if (!cancelled) setErr("Couldn't load the recording.");
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [agentId, callId]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, audioRef, src]);

  if (err) return <p className="error-text">{err}</p>;
  if (!src) return <p className="muted">Loading recording…</p>;

  const progress = duration > 0 ? Math.min(time / duration, 1) : 0;
  const seek = (fraction: number) => {
    const a = audioRef.current;
    if (a && duration > 0) a.currentTime = fraction * duration;
  };

  return (
    <div className="recording">
      {tracks && tracks.length > 0 ? (
        <div className="waves">
          {tracks.map((t) => (
            <Waveform key={t.label} track={t} progress={progress} onSeek={seek} />
          ))}
          <div className="wave-axis muted">
            <span>{fmtClock(time)}</span>
            <span>{fmtClock(duration)}</span>
          </div>
        </div>
      ) : (
        tracks && <p className="muted">Waveform unavailable in this browser.</p>
      )}
      <div className="recording-controls">
        <audio
          ref={audioRef}
          controls
          src={src}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        />
        <select
          className="input"
          aria-label="Playback speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
        <a className="btn" href={src} download={`${callId}.wav`}>
          Download
        </a>
      </div>
    </div>
  );
}

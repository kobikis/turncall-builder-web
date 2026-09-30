import { useEffect, useState } from "react";
import { api } from "../../api";
import { Call, Spread } from "../../types";

type TurnMetrics = {
  turn: number;
  user_to_bot_ms: number;
  stages: Partial<Record<Stage, { ttfb_ms: number; service: string }>>;
};
type Stage = "stt" | "llm" | "tts";

const STAGES: [Stage, string][] = [
  ["stt", "STT"],
  ["llm", "LLM"],
  ["tts", "TTS"],
];

function Tile({ label, spread }: { label: string; spread?: Spread }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      {spread ? (
        <>
          <span className="stat-value">p50 {spread.p50_ms} ms</span>
          <span className="muted">p95 {spread.p95_ms} ms</span>
        </>
      ) : (
        <span className="muted">—</span>
      )}
    </div>
  );
}

/** Per-turn latency (turncall #176/#179): summary tiles from the call's
 * `latency_summary`, then one row per `metrics.turn` event. A stage the call
 * never had (TTS on speech-to-speech) is blank, never zero. */
export default function LatencySection({ agentId, call }: { agentId: string; call: Call }) {
  const summary = call.latency_summary;
  const [turns, setTurns] = useState<TurnMetrics[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!summary) return;
    api(`/agents/${agentId}/calls/${call.id}/events?event_type=metrics.turn`)
      .then((r) => setTurns((r.data || []).map((e: { payload: TurnMetrics }) => e.payload)))
      .catch((e) => setError(e.message));
  }, [agentId, call.id, summary]);

  return (
    <section aria-labelledby={`latency-${call.id}`}>
      <h3 id={`latency-${call.id}`}>Latency</h3>
      {!summary ? (
        <p className="muted">No latency measured for this call.</p>
      ) : (
        <>
          <div className="stat-tiles">
            <Tile label="User → agent" spread={summary.user_to_bot} />
            {STAGES.map(([k, label]) => (
              <Tile key={k} label={`${label} first byte`} spread={summary.stages[k]} />
            ))}
          </div>
          {error && <p className="error-text">{error}</p>}
          {turns && (
            <div className="table-scroll">
              <table className="list latency-table">
                <thead>
                  <tr>
                    <th>Turn</th>
                    {STAGES.map(([k, label]) => (
                      <th key={k} className="num">{label} (ms)</th>
                    ))}
                    <th className="num">User → agent (ms)</th>
                  </tr>
                </thead>
                <tbody>
                  {turns.map((t) => (
                    <tr key={t.turn} className={t.turn === summary.slowest_turn.turn ? "slowest" : ""}>
                      <td>{t.turn}</td>
                      {STAGES.map(([k]) => (
                        <td key={k} className="num">{t.stages[k]?.ttfb_ms ?? "—"}</td>
                      ))}
                      <td className="num">
                        {t.user_to_bot_ms}
                        {t.turn === summary.slowest_turn.turn && <span className="badge failed">slowest</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

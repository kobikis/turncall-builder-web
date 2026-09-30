import { useEffect, useState } from "react";
import { api } from "../../api";
import { Call } from "../../types";

type Message = {
  role?: string;
  content?: unknown;
  tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
};
type Segment = {
  segment: number;
  agent_id: string | null;
  system_instruction: string;
  messages: Message[];
};
type Snapshot = { status: "captured" | "switched_off" | "not_captured"; segments: Segment[] };

const text = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

const ROLE_LABEL: Record<string, string> = {
  user: "Caller",
  assistant: "Agent",
  tool: "Tool result",
  system: "System",
  // Pipecat's own note to the model, e.g. after an utterance it could not
  // transcribe. Neither party said it.
  developer: "Pipeline note",
};

function MessageRow({ m }: { m: Message }) {
  const role = m.role ?? "message";
  return (
    <div className={`ctx-msg ${role}`}>
      <span className="ctx-role">{ROLE_LABEL[role] ?? role}</span>
      {m.tool_calls?.map((c, i) => (
        <div key={i} className="ctx-tool-call">
          Called <code>{c.function?.name}</code>
          <pre>{text(c.function?.arguments)}</pre>
        </div>
      ))}
      {m.content != null && m.content !== "" && <pre>{text(m.content)}</pre>}
    </div>
  );
}

/** What the model was given (turncall #177/#180): one section per agent the
 * call ran, open, with only the long system instruction folded away. Only the
 * call's active agent has a name to hand; an earlier one shows its id. */
export default function ContextSection({ agentId, call }: { agentId: string; call: Call }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/agents/${agentId}/calls/${call.id}/context`)
      .then((r) => setSnapshot(r.data))
      .catch((e) => setError(e.message));
  }, [agentId, call.id]);

  const title = (s: Segment) =>
    s.agent_id == null
      ? "Inline agent"
      : s.agent_id === call.active_agent_id && call.agent_name
        ? call.agent_name
        : `Agent ${s.agent_id.slice(0, 8)}…`;

  return (
    <section aria-labelledby={`context-${call.id}`}>
      <h3 id={`context-${call.id}`}>Context</h3>
      {error && <p className="error-text">{error}</p>}
      {!snapshot && !error && <p className="muted">Loading…</p>}
      {snapshot?.status === "switched_off" && (
        <p className="muted">Context capture is switched off for this agent.</p>
      )}
      {snapshot?.status === "not_captured" && (
        <p className="muted">
          No context was captured for this call. Calls made before context capture
          was added have none, and so does a call that ended before the agent started.
        </p>
      )}
      {snapshot?.segments.map((s) => (
        <details key={s.segment} className="ctx-segment" open>
          <summary>
            <strong>{title(s)}</strong>
            <span className="muted"> · {s.messages.length} messages</span>
          </summary>
          <details className="ctx-block">
            <summary>System instruction</summary>
            <pre>{s.system_instruction}</pre>
          </details>
          {s.messages.map((m, i) => (
            <MessageRow key={i} m={m} />
          ))}
        </details>
      ))}
    </section>
  );
}

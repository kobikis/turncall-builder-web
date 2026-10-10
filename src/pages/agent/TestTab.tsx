import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useAgent } from "./AgentPage";
import SaveAsScenario from "./SaveAsScenario";
import { filled, loadValues, placeholders, saveValues } from "./testVariables";

// Voice pulls in the (heavy) pipecat WebRTC client — code-split so it only loads
// when the Voice tab is actually opened.
const VoiceTest = lazy(() => import("./VoiceTest"));

// In-console testing: chat over the text Chat API, or a live WebRTC voice call —
// both hit the real agent (prompt, tools, knowledge base).
type Msg = { role: "user" | "assistant"; text: string };
const freshCustomer = () => "+1555" + Math.floor(1000000 + Math.random() * 9000000);

export default function TestTab() {
  const { agentId, draft } = useAgent();
  const [mode, setMode] = useState<"chat" | "voice">("chat");
  const names = placeholders(draft);
  const [values, setValues] = useState(() => loadValues(agentId));
  const variables = filled(names, values);

  function setValue(name: string, value: string) {
    setValues((prev) => {
      const next = { ...prev, [name]: value };
      saveValues(agentId, next);
      return next;
    });
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div role="group" aria-label="Test mode" className="seg" style={{ alignSelf: "flex-start", marginBottom: 10 }}>
        <button type="button" aria-pressed={mode === "chat"} onClick={() => setMode("chat")}>Chat</button>
        <button type="button" aria-pressed={mode === "voice"} onClick={() => setMode("voice")}>Voice</button>
      </div>
      {names.length > 0 && <Variables names={names} values={values} onChange={setValue} />}
      {mode === "chat" ? (
        <ChatTest agentId={agentId} variables={variables} />
      ) : (
        <Suspense fallback={<p className="muted">Loading voice…</p>}>
          <VoiceTest agentId={agentId} variables={variables} />
        </Suspense>
      )}
    </div>
  );
}

// One input per {{placeholder}} the agent uses — what call-init would fill on
// a real call. Shown only when there is one.
function Variables({
  names,
  values,
  onChange,
}: {
  names: string[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  return (
    <fieldset className="test-variables">
      <legend>Variables</legend>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
        Fill the prompt's <code>{"{{placeholders}}"}</code> as call-init would on a real call. Chat uses
        them from the next message, voice from the next call.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {names.map((name) => (
          <div key={name} className="field" style={{ flex: "1 1 160px", marginBottom: 0 }}>
            <label htmlFor={`test-var-${name}`}>{name}</label>
            <input
              id={`test-var-${name}`}
              className="input"
              value={values[name] ?? ""}
              onChange={(e) => onChange(name, e.target.value)}
              placeholder={`{{${name}}}`}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function ChatTest({ agentId, variables }: { agentId: string; variables: Record<string, string> }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // State rather than a ref: whether a conversation exists to save decides
  // whether the button is shown, so React has to re-render when it appears.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const customer = useRef(freshCustomer());
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [msgs, busy]);

  async function send() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setError("");
    setBusy(true);
    try {
      const r = await api(`/agents/${agentId}/chat`, {
        method: "POST",
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          customer_number: customer.current,
          // Merged into the session's by TurnCall: a value changed here applies
          // from this message on; Reset starts a session without the old ones.
          ...(Object.keys(variables).length > 0 && { variables }),
        }),
      });
      setSessionId(r.data.session_id);
      setMsgs((m) => [...m, { role: "assistant", text: r.data.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed — is the agent published?");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setMsgs([]);
    setError("");
    setSessionId(null);
    customer.current = freshCustomer();
  }

  return (
    <>
      <p className="muted" style={{ margin: "0 0 8px" }}>
        Chat with the agent as a caller would — exercises its prompt, tools, and knowledge base.
      </p>
      <div ref={chatRef} className="chat" style={{ flex: 1 }}>
        {msgs.length === 0 && <p className="muted">Send a message to start testing.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`row ${m.role}`}>
            <span className="bubble">{m.text}</span>
          </div>
        ))}
        {busy && <p className="muted">…</p>}
        {error && <p role="alert" className="error-text">{error}</p>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          aria-label="Message the agent"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
          placeholder="Ask the agent something a caller would…"
        />
        <button className="btn btn-primary" onClick={send} disabled={busy}>Send</button>
        <button className="btn" onClick={reset} disabled={busy || msgs.length === 0}>Reset</button>
      </div>
      {/* The conversation you just had by hand becomes a check that runs
          forever (turncall#87). Only once there is one to save. */}
      {sessionId && (
        <SaveAsScenario
          agentId={agentId}
          sessionId={sessionId}
          label="Save this conversation as a scenario"
        />
      )}
    </>
  );
}

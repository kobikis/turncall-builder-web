import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useAgent } from "./AgentPage";

// Voice pulls in the (heavy) pipecat WebRTC client — code-split so it only loads
// when the Voice tab is actually opened.
const VoiceTest = lazy(() => import("./VoiceTest"));

// In-console testing: chat over the text Chat API, or a live WebRTC voice call —
// both hit the real agent (prompt, tools, knowledge base).
type Msg = { role: "user" | "assistant"; text: string };
const freshCustomer = () => "+1555" + Math.floor(1000000 + Math.random() * 9000000);

export default function TestTab() {
  const { agentId } = useAgent();
  const [mode, setMode] = useState<"chat" | "voice">("chat");

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", maxWidth: 720 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button className={`btn${mode === "chat" ? " btn-primary" : ""}`} onClick={() => setMode("chat")}>
          Chat
        </button>
        <button className={`btn${mode === "voice" ? " btn-primary" : ""}`} onClick={() => setMode("voice")}>
          Voice
        </button>
      </div>
      {mode === "chat" ? (
        <ChatTest agentId={agentId} />
      ) : (
        <Suspense fallback={<p className="muted">Loading voice…</p>}>
          <VoiceTest agentId={agentId} />
        </Suspense>
      )}
    </div>
  );
}

function ChatTest({ agentId }: { agentId: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sessionId = useRef<string | null>(null);
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
        body: JSON.stringify({ message: text, session_id: sessionId.current, customer_number: customer.current }),
      });
      sessionId.current = r.data.session_id;
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
    sessionId.current = null;
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
    </>
  );
}

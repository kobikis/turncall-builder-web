import { useAuth } from "../../auth";
import { canEdit } from "../../roles";
import { useAgent } from "./AgentPage";
import { useVoiceCall } from "./VoiceCall";

// Thin view over the agent-level voice call (see VoiceCall.tsx). The call itself
// lives in the provider, so leaving/re-entering this tab doesn't end it.
export default function VoiceTest({ agentId }: { agentId: string }) {
  const { data, dirty, save } = useAgent();
  const { activeWorkspace } = useAuth();
  const canTest = canEdit(activeWorkspace?.role); // test calls are editor+ (server 403s viewers)
  const isS2S = ((data.config as any)?.pipeline_mode || "cascade") === "s2s";
  const { state, msg, start, stop } = useVoiceCall();

  const live = state === "connected" || state === "connecting";
  return (
    <div style={{ flex: 1 }}>
      <p className="muted" style={{ margin: "0 0 12px" }}>
        Talk to the agent in your browser over WebRTC — needs mic access. Exercises the full
        voice pipeline ({isS2S ? "speech-to-speech — a single realtime model" : "STT → LLM → TTS"}).
        The call keeps running if you switch tabs.
      </p>
      {!canTest ? (
        <p className="callout info">Test calls require editor access.</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {live ? (
            <button className="btn btn-danger" onClick={stop}>End call</button>
          ) : (
            // A test runs the saved agent, so an unsaved edit is saved first.
            <button
              className="btn btn-accent"
              onClick={async () => {
                if (dirty.length > 0 && !(await save())) return;
                void start(agentId);
              }}
            >
              {dirty.length > 0 ? "Save and start a test call" : "Start a test call"}
            </button>
          )}
          <span className={`badge ${state === "connected" ? "running" : state === "error" ? "failed" : ""}`}>
            {state}
          </span>
          <span aria-live="polite" className="muted" style={{ fontSize: 13 }}>{msg}</span>
        </div>
      )}
    </div>
  );
}

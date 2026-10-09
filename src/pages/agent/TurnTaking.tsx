// When the caller's turn ends, and when the call ends (#63). Top-level agent
// settings, all optional: a blank field is TurnCall's default.
import { NumberField } from "./SettingFields";

type Cfg = Record<string, unknown>;

export function TurnTaking({ cfg, isS2S, editable, onSet }: {
  cfg: Cfg;
  isS2S: boolean;
  editable: boolean;
  /** undefined / "" removes the key. */
  onSet: (key: string, value: unknown) => void;
}) {
  const smartTurn = cfg.smart_turn_detection !== false;
  const bargeIn = cfg.interruption_enabled !== false;
  // A checkbox's "on" is TurnCall's default, so it is the key removed.
  const toggle = (key: string, on: boolean) => onSet(key, on ? undefined : false);

  return (
    <>
      {isS2S ? (
        <p className="hint">
          Speech-to-speech: the realtime model decides when the caller has finished and handles interruptions, so the turn-taking settings don't apply.
        </p>
      ) : (
        <>
          <div className="radio-row">
            <label>
              <input type="checkbox" checked={smartTurn} disabled={!editable}
                onChange={(e) => toggle("smart_turn_detection", e.target.checked)} />{" "}
              Smart Turn (an ML model judges whether the caller has finished)
            </label>
            <label>
              <input type="checkbox" checked={bargeIn} disabled={!editable}
                onChange={(e) => toggle("interruption_enabled", e.target.checked)} />{" "}
              Caller can interrupt the agent
            </label>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {smartTurn ? (
              <NumberField id="cfg-st-stop" label="Smart Turn wait (s)" step="0.1"
                value={cfg.smart_turn_stop_secs} placeholder="1.0" disabled={!editable}
                hint="How long silence lasts before an unsure model ends the turn anyway."
                onChange={(v) => onSet("smart_turn_stop_secs", v)} />
            ) : (
              <NumberField id="cfg-silence" label="Silence window (ms)"
                value={cfg.silence_timeout_ms} placeholder="800" disabled={!editable}
                hint="Silence that ends the caller's turn."
                onChange={(v) => onSet("silence_timeout_ms", v)} />
            )}
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 12 }}>
        <NumberField id="cfg-idle" label="Idle check-in (ms, 0 = off)"
          value={cfg.user_idle_timeout_ms} placeholder="10000" disabled={!editable}
          hint="After this much caller silence the agent checks in; a second silence ends the call."
          onChange={(v) => onSet("user_idle_timeout_ms", v)} />
        <NumberField id="cfg-max-dur" label="Max call duration (s)"
          value={cfg.max_call_duration_seconds} placeholder="3600" disabled={!editable}
          onChange={(v) => onSet("max_call_duration_seconds", v)} />
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="cfg-idle-msg">Idle check-in message</label>
          <input id="cfg-idle-msg" className="input" value={String(cfg.idle_message ?? "")}
            placeholder="Are you still there?" disabled={!editable || isS2S}
            onChange={(e) => onSet("idle_message", e.target.value)} />
          {isS2S && <p className="hint" style={{ margin: "4px 0 0" }}>Speech-to-speech: the model words the check-in itself.</p>}
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="cfg-lang">Language</label>
          <input id="cfg-lang" className="input" value={String(cfg.language ?? "")}
            placeholder="en" disabled={!editable}
            onChange={(e) => onSet("language", e.target.value.trim())} />
        </div>
      </div>
    </>
  );
}

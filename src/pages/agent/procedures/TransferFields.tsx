// What an escalate step does in the Builder: a transfer, with the
// `transfer_call` tool's fields. A handoff already in a config is kept as
// written and shown, never offered: each Builder agent is its own TurnCall
// project, so a handoff to another one cannot run.
import type { StepEscalation, TransferEscalation } from "../../../types";
import { withField } from "../SettingFields";

type Props = {
  id: string;
  escalate: StepEscalation | undefined;
  onChange: (next: StepEscalation) => void;
};

export function TransferFields({ id, escalate, onChange }: Props) {
  const handoff = escalate?.handoff_to_agent;
  if (handoff && !escalate?.transfer_call) {
    return (
      <p className="hint">
        Hands the call to agent <span className="mono">{handoff.agent_id}</span>. Kept as written: the Builder
        escalates by transfer only.
      </p>
    );
  }
  const t: TransferEscalation = escalate?.transfer_call ?? { target_number: "" };
  const set = (key: keyof TransferEscalation, value: unknown) =>
    onChange({ ...escalate, transfer_call: withField(t, key, value) });
  const warm = t.transfer_mode === "warm";
  const summary = typeof t.briefing === "object" && t.briefing !== null;

  return (
    <div className="procedure-transfer">
      <div className="procedure-row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`${id}-to`}>Transfer to</label>
          <input id={`${id}-to`} className="input mono" value={t.target_number} placeholder="+15551234567"
            onChange={(e) => onChange({ ...escalate, transfer_call: { ...t, target_number: e.target.value } })} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-mode`}>Transfer</label>
          <select id={`${id}-mode`} className="input" value={t.transfer_mode ?? "cold"}
            onChange={(e) => set("transfer_mode", e.target.value === "cold" ? "" : e.target.value)}>
            <option value="cold">Cold</option>
            <option value="warm">Warm (brief the operator first)</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-msg`}>Said to the caller</label>
        <input id={`${id}-msg`} className="input" value={t.transfer_message ?? ""} placeholder="Optional"
          onChange={(e) => set("transfer_message", e.target.value)} />
      </div>
      {warm && (
        <fieldset className="field procedure-briefing">
          <legend>Briefing for the operator</legend>
          <label>
            <input type="radio" name={`${id}-briefing`} checked={!summary}
              onChange={() => set("briefing", "")} /> Written
          </label>
          <label>
            <input type="radio" name={`${id}-briefing`} checked={summary}
              onChange={() => set("briefing", { from_summary: true })} /> A summary of the call so far
          </label>
          {!summary && (
            <textarea className="input" rows={2} aria-label="Briefing" value={typeof t.briefing === "string" ? t.briefing : ""}
              onChange={(e) => set("briefing", e.target.value)} />
          )}
        </fieldset>
      )}
      <div className="field">
        <label htmlFor={`${id}-fallback`}>If nobody answers</label>
        <input id={`${id}-fallback`} className="input" value={t.fallback_message ?? ""} placeholder="Optional"
          onChange={(e) => set("fallback_message", e.target.value)} />
      </div>
    </div>
  );
}

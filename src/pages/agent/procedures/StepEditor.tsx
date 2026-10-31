// One step of a procedure: its id, kind, text, an optional tool, the moves
// out of it, and — on an escalate step — the transfer it runs.
import { useEffect, useState } from "react";
import type { ProcedureMove, ProcedureStep, StepKind } from "../../../types";
import { OTHER_TOOL, allNames, type StepToolChoices } from "./stepTools";
import { TransferFields } from "./TransferFields";

export const KINDS: { value: StepKind; label: string }[] = [
  { value: "ask", label: "Ask" },
  { value: "instruct", label: "Instruct" },
  { value: "check", label: "Check" },
  { value: "escalate", label: "Escalate (transfer)" },
  { value: "end", label: "End" },
];

type Props = {
  id: string;
  step: ProcedureStep;
  /** Every step id of the procedure, this one's included. */
  stepIds: string[];
  /** What the step's tool is picked from. */
  tools: StepToolChoices;
  errors: string[];
  editable: boolean;
  onChange: (next: ProcedureStep) => void;
  /** A new id, carried to every move that names this step. */
  onRename: (to: string) => void;
  onRemove: () => void;
};

const STEP_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function StepEditor({ id, step, stepIds, tools, errors, editable, onChange, onRename, onRemove }: Props) {
  // The id is committed when the field is left: renaming on every keystroke
  // would carry moves through each half-typed id, merging them with any step
  // the half-typed id happened to match.
  const [idText, setIdText] = useState(step.id);
  const [idProblem, setIdProblem] = useState("");
  useEffect(() => setIdText(step.id), [step.id]);

  const commitId = () => {
    const next = idText.trim();
    if (next === step.id) return setIdProblem("");
    const problem = !STEP_ID.test(next)
      ? "Letters, digits, _ and - only, up to 64."
      : stepIds.includes(next)
        ? `Another step is "${next}".`
        : "";
    setIdProblem(problem);
    if (problem) setIdText(step.id);
    else onRename(next);
  };

  const moves = step.moves ?? [];
  const targets = stepIds.filter((s) => s !== step.id);
  const setMoves = (next: ProcedureMove[]) => {
    const { moves: _, ...rest } = step;
    onChange(next.length ? { ...rest, moves: next } : rest);
  };
  const setMove = (i: number, move: ProcedureMove) => setMoves(moves.map((m, n) => (n === i ? move : m)));

  const setKind = (kind: StepKind) => {
    const { escalate, ...rest } = step;
    onChange(kind === "escalate" ? { ...rest, kind, escalate: escalate ?? { transfer_call: { target_number: "" } } } : { ...rest, kind });
  };
  const setTool = (tool: string) => {
    const { tool: _, ...rest } = step;
    onChange(tool ? { ...rest, tool } : rest);
  };
  const names = allNames(tools);
  const unlisted = Boolean(step.tool) && !names.includes(step.tool!);
  // A name no list holds is an MCP tool's on an agent with servers; on one
  // without, it is a tool the agent lacks, which TurnCall refuses at Save.
  const [typing, setTyping] = useState(tools.typed && unlisted);
  const pickTool = (value: string) => {
    setTyping(value === OTHER_TOOL);
    setTool(value === OTHER_TOOL ? "" : value);
  };

  return (
    <li className="procedure-step" aria-label={`Step ${step.id}`}>
      <div className="procedure-row">
        <div className="field">
          <label htmlFor={`${id}-id`}>Step id</label>
          <input id={`${id}-id`} className="input mono" value={idText}
            onChange={(e) => setIdText(e.target.value)} onBlur={commitId} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-kind`}>Kind</label>
          <select id={`${id}-kind`} className="input" value={step.kind} onChange={(e) => setKind(e.target.value as StepKind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`${id}-tool`}>Tool</label>
          <select id={`${id}-tool`} className="input" value={typing ? OTHER_TOOL : (step.tool ?? "")}
            onChange={(e) => pickTool(e.target.value)}>
            <option value="">No tool</option>
            {unlisted && !typing && <option value={step.tool}>{step.tool} (not one of the agent's tools)</option>}
            {tools.groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.names.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
            ))}
            {tools.typed && <option value={OTHER_TOOL}>{OTHER_TOOL}</option>}
          </select>
          {typing && (
            <input className="input mono" aria-label="MCP tool name" value={step.tool ?? ""}
              placeholder="the tool's name on its server" onChange={(e) => setTool(e.target.value)} />
          )}
        </div>
        {editable && (
          <button type="button" className="btn" aria-label={`Remove step ${step.id}`} onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {idProblem && <p className="error-text">{idProblem}</p>}
      <div className="field">
        <label htmlFor={`${id}-text`}>What to do</label>
        <textarea id={`${id}-text`} className="input" rows={2} value={step.text}
          onChange={(e) => onChange({ ...step, text: e.target.value })} />
      </div>

      {step.kind === "escalate" && (
        <TransferFields id={id} escalate={step.escalate} onChange={(escalate) => onChange({ ...step, escalate })} />
      )}

      {moves.length > 0 && (
        <ul className="procedure-moves" aria-label={`Moves from ${step.id}`}>
          {moves.map((m, i) => (
            <li key={i} className="procedure-row">
              <select className="input" aria-label={`Target of move ${i + 1}`} value={m.to}
                onChange={(e) => setMove(i, { ...m, to: e.target.value })}>
                {!stepIds.includes(m.to) && <option value={m.to}>{m.to || "—"} (no such step)</option>}
                {targets.map((t) => (
                  <option key={t} value={t}>→ {t}</option>
                ))}
              </select>
              <input className="input" style={{ flex: 1 }} aria-label={`Condition of move ${i + 1}`} value={m.when}
                placeholder="when the caller…" onChange={(e) => setMove(i, { ...m, when: e.target.value })} />
              {editable && (
                <button type="button" className="btn" aria-label={`Remove move ${i + 1}`}
                  onClick={() => setMoves(moves.filter((_, n) => n !== i))}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && targets.length > 0 && (
        <button type="button" className="link-btn" onClick={() => setMoves([...moves, { to: targets[0], when: "" }])}>
          Add move
        </button>
      )}
      {errors.map((m) => (
        <p key={m} className="error-text">{m}</p>
      ))}
    </li>
  );
}

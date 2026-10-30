// The agent's procedures (turncall#417): graphs of steps it follows on a
// cascade call, the model shown the current step and where it may go next.
// `procedures` in its config, saved with the rest of it by the page's Save;
// TurnCall checks the graphs then, and its refusal of one procedure is shown
// on that procedure, or on the step its message names.
import type { FieldError } from "../../../api";
import type { Procedure } from "../../../types";
import { errorsAt, errorsUnder } from "../../skills/fieldErrors";
import { addStep } from "./edits";
import { ProcedureCard } from "./ProcedureCard";

type Props = {
  procedures: Procedure[];
  /** The tools the agent can call: what a step's tool is picked from. */
  toolNames: string[];
  isS2S: boolean;
  editable: boolean;
  /** The last save's refused fields: `procedures[i]`, `procedures[i].steps[j]`. */
  errors: FieldError[];
  onChange: (next: Procedure[]) => void;
};

const freshName = (procedures: Procedure[]): string => {
  const taken = new Set(procedures.map((p) => p.name));
  let n = procedures.length + 1;
  while (taken.has(`procedure_${n}`)) n += 1;
  return `procedure_${n}`;
};

export function AgentProcedures({ procedures, toolNames, isS2S, editable, errors, onChange }: Props) {
  const add = () => onChange([...procedures, addStep({ name: freshName(procedures), steps: [] })]);
  return (
    <>
      {isS2S && (
        <p className="callout warn">
          A speech-to-speech agent follows no procedures: TurnCall runs its calls without them. They apply if the
          agent goes back to the cascade pipeline.
        </p>
      )}
      {errorsAt(errors, "procedures").map((m) => (
        <p key={m} className="error-text">{m}</p>
      ))}
      {procedures.length === 0 && <p className="muted">This agent has no procedures.</p>}
      {procedures.map((p, i) => (
        <ProcedureCard key={i} index={i} procedure={p} toolNames={toolNames} editable={editable}
          errors={errors.filter((e) => errorsUnder([e], `procedures[${i}]`).length > 0)}
          onChange={(next) => onChange(procedures.map((q, n) => (n === i ? next : q)))}
          onRemove={() => onChange(procedures.filter((_, n) => n !== i))} />
      ))}
      {editable && (
        <button type="button" className="btn" onClick={add}>Add procedure</button>
      )}
      <p className="hint">
        Each turn the agent sees the step it is on, the moves it may make and the steps just ahead, and reports
        each move. Reaching an end or escalate step finishes the procedure.
      </p>
    </>
  );
}

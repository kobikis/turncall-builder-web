// One procedure: when it applies, how it starts, how far ahead the model sees,
// its start step and its steps, with the outline of its graph beside them.
import type { FieldError } from "../../../api";
import type { Procedure } from "../../../types";
import { errorsUnder } from "../../skills/fieldErrors";
import { NumberField, withField } from "../SettingFields";
import { addStep, removeStep, renameStep, replaceStep, setStartStep } from "./edits";
import { ProcedureOutline } from "./ProcedureOutline";
import { StepEditor } from "./StepEditor";

// TurnCall's default window depth, and the most it allows.
export const DEFAULT_WINDOW_DEPTH = 1;
export const MAX_WINDOW_DEPTH = 5;

type Props = {
  index: number;
  procedure: Procedure;
  toolNames: string[];
  errors: FieldError[];
  editable: boolean;
  onChange: (next: Procedure) => void;
  onRemove: () => void;
};

export function ProcedureCard({ index, procedure: p, toolNames, errors, editable, onChange, onRemove }: Props) {
  const at = `procedures[${index}]`;
  const id = `proc-${index}`;
  const stepIds = p.steps.map((s) => s.id);
  // Its own messages: the ones naming a step are shown on that step.
  const own = errors.filter((e) => !e.field.startsWith(`${at}.steps[`));
  const set = (key: keyof Procedure, value: unknown) => onChange(withField(p, key, value));

  return (
    <fieldset className="procedure-card" aria-label={`Procedure ${index + 1}`} disabled={!editable}>
      <div className="procedure-form">
        <div className="procedure-row">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor={`${id}-name`}>Name</label>
            <input id={`${id}-name`} className="input mono" value={p.name} onChange={(e) => onChange({ ...p, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-start`}>Starts</label>
            <select id={`${id}-start`} className="input" value={p.start ?? "call"}
              onChange={(e) => set("start", e.target.value === "call" ? "" : e.target.value)}>
              <option value="call">With the call</option>
              <option value="on_request">When the agent starts it</option>
            </select>
          </div>
          {editable && (
            <button type="button" className="btn btn-danger-ghost" aria-label={`Remove procedure ${p.name || index + 1}`} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
        <div className="field">
          <label htmlFor={`${id}-desc`}>When it applies</label>
          <input id={`${id}-desc`} className="input" value={p.description ?? ""} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="procedure-row">
          <div className="field">
            <label htmlFor={`${id}-first`}>Start step</label>
            <select id={`${id}-first`} className="input" value={p.steps.find((s) => s.start)?.id ?? ""}
              onChange={(e) => onChange(setStartStep(p, e.target.value))}>
              {!p.steps.some((s) => s.start) && <option value="">—</option>}
              {stepIds.map((s, i) => (
                <option key={`${s}:${i}`} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <NumberField id={`${id}-depth`} label="Steps shown ahead" value={p.window_depth} min={1} max={MAX_WINDOW_DEPTH}
            placeholder={String(DEFAULT_WINDOW_DEPTH)} disabled={!editable}
            hint={`1–${MAX_WINDOW_DEPTH}. Empty means ${DEFAULT_WINDOW_DEPTH}. The rest of the graph never reaches the prompt.`}
            onChange={(v) => set("window_depth", v)} />
        </div>
        {own.map((e) => (
          <p key={e.message} className="error-text">{e.message}</p>
        ))}

        <ol className="procedure-steps">
          {p.steps.map((step, j) => (
            <StepEditor key={j} id={`${id}-step-${j}`} step={step} stepIds={stepIds} toolNames={toolNames}
              errors={errorsUnder(errors, `${at}.steps[${j}]`)} editable={editable}
              onChange={(next) => onChange(replaceStep(p, j, next))}
              onRename={(to) => onChange(renameStep(p, step.id, to))}
              onRemove={() => onChange(removeStep(p, step.id))} />
          ))}
        </ol>
        {editable && (
          <button type="button" className="btn" onClick={() => onChange(addStep(p))}>Add step</button>
        )}
      </div>
      <ProcedureOutline procedure={p} />
    </fieldset>
  );
}

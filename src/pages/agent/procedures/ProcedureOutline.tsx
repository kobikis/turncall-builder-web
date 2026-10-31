// A read-only outline of one procedure's graph, beside its form: the steps in
// the order a call can reach them from the start, each with its moves. A step
// nothing reaches is listed apart — TurnCall refuses a procedure with one.
import type { Procedure, ProcedureStep } from "../../../types";

/** The steps in the order a walk from the start reaches them, then the rest. */
export function outlineOrder(p: Procedure): { reached: ProcedureStep[]; unreached: ProcedureStep[] } {
  const byId = new Map(p.steps.map((s) => [s.id, s]));
  const start = p.steps.find((s) => s.start);
  const seen = new Set<string>();
  const queue = start ? [start.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    queue.push(...(byId.get(id)!.moves ?? []).map((m) => m.to));
  }
  const reached = [...seen].map((id) => byId.get(id)!);
  return { reached, unreached: p.steps.filter((s) => !seen.has(s.id)) };
}

const ending = (s: ProcedureStep) => s.kind === "end" || s.kind === "escalate";

function Item({ step }: { step: ProcedureStep }) {
  return (
    <li>
      <span className="mono">{step.id}</span> <span className="muted">· {step.kind}{step.start ? " · start" : ""}</span>
      {ending(step) && <span className="muted"> · finishes the procedure</span>}
      {(step.moves ?? []).length > 0 && (
        <ul>
          {step.moves!.map((m, i) => (
            <li key={i}>
              → <span className="mono">{m.to}</span>
              {m.when && <span className="muted"> when {m.when}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ProcedureOutline({ procedure }: { procedure: Procedure }) {
  const { reached, unreached } = outlineOrder(procedure);
  return (
    <aside className="procedure-outline" aria-label={`Outline of ${procedure.name || "the procedure"}`}>
      <div className="wb-kicker">Outline</div>
      {reached.length === 0 && <p className="muted">No start step.</p>}
      <ol>
        {reached.map((s) => (
          <Item key={s.id} step={s} />
        ))}
      </ol>
      {unreached.length > 0 && (
        <>
          <p className="error-text">Not reachable from the start:</p>
          <ul>
            {unreached.map((s, i) => (
              <Item key={`${s.id}:${i}`} step={s} />
            ))}
          </ul>
        </>
      )}
      <p className="hint">A move back to the previous step is always allowed.</p>
    </aside>
  );
}

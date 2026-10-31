// Edits to one procedure's graph, each returning a new procedure. A move names
// its target by step id, so the edits that touch ids (rename, remove) carry
// the moves along: renaming a step keeps every move to it, removing one drops
// them, rather than leaving a move TurnCall refuses.
import type { Procedure, ProcedureStep } from "../../../types";

const withSteps = (p: Procedure, steps: ProcedureStep[]): Procedure => ({ ...p, steps });

/** `step` without `key`: an absent key is TurnCall's default. */
const without = <K extends keyof ProcedureStep>(step: ProcedureStep, key: K): ProcedureStep => {
  const next = { ...step };
  delete next[key];
  return next;
};

export function renameStep(p: Procedure, from: string, to: string): Procedure {
  return withSteps(
    p,
    p.steps.map((s) => ({
      ...(s.id === from ? { ...s, id: to } : s),
      ...(s.moves && { moves: s.moves.map((m) => (m.to === from ? { ...m, to } : m)) }),
    })),
  );
}

export function setStartStep(p: Procedure, id: string): Procedure {
  return withSteps(p, p.steps.map((s) => (s.id === id ? { ...s, start: true } : without(s, "start"))));
}

export function removeStep(p: Procedure, id: string): Procedure {
  const wasStart = p.steps.find((s) => s.id === id)?.start;
  const left = p.steps
    .filter((s) => s.id !== id)
    .map((s) => (s.moves ? { ...s, moves: s.moves.filter((m) => m.to !== id) } : s));
  const next = withSteps(p, left);
  return wasStart && left.length ? setStartStep(next, left[0].id) : next;
}

/** An id no step of `p` has: `step_<n>`, counting on from the steps there. */
export const freshStepId = (p: Procedure): string => {
  const taken = new Set(p.steps.map((s) => s.id));
  let n = p.steps.length + 1;
  while (taken.has(`step_${n}`)) n += 1;
  return `step_${n}`;
};

export function addStep(p: Procedure): Procedure {
  const step: ProcedureStep = { id: freshStepId(p), kind: "ask", text: "", ...(p.steps.length === 0 && { start: true }) };
  return withSteps(p, [...p.steps, step]);
}

/** `p` with its step at `index` replaced. */
export const replaceStep = (p: Procedure, index: number, step: ProcedureStep): Procedure =>
  withSteps(p, p.steps.map((s, i) => (i === index ? step : s)));

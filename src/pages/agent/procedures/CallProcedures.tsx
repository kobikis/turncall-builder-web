// What a call did of each procedure (turncall#443): the steps it reached, in
// order (a move back included), where it ended, and the moves refused.
import type { CallProcedure } from "../../../types";
import { Section } from "../Section";

/** Where it ended: an end step, an escalate step, or wherever the call (or a
 *  handoff) left it. */
export const procedureOutcome = (p: CallProcedure): string =>
  p.completed ? "Completed" : p.escalated_at ? `Escalated at ${p.escalated_at}` : `Left at ${p.ended_at ?? "its start"}`;

export function CallProcedures({ procedures }: { procedures: CallProcedure[] }) {
  const completed = procedures.filter((p) => p.completed).length;
  return (
    <Section id="call.procedures" title="Procedures" hint={`${completed} of ${procedures.length} completed`}>
      <table className="list">
        <thead>
          <tr><th>Procedure</th><th>Path</th><th>Ended</th><th>Refused moves</th></tr>
        </thead>
        <tbody>
          {procedures.map((p) => (
            <tr key={p.name} aria-label={`Procedure ${p.name}`}>
              <td className="mono">{p.name}</td>
              <td className="mono">{p.path.join(" → ")}</td>
              <td>
                <span className={`badge ${p.completed ? "running" : p.escalated_at ? "degraded" : "stopped"}`}>
                  {procedureOutcome(p)}
                </span>
              </td>
              <td className="num nowrap">{p.refused_moves ? `${p.refused_moves} refused` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

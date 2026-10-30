// Which agents a Capability reaches (builder-api #134): every draft or
// published agent version listing it, across the Workspace's projects, with
// the version each resolves to now and whether it is pinned. A change to the
// Capability reaches exactly the ones that follow the live version.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { errMsg } from "../../errors";
import type { ApiResponse, CapabilityAgent, CapabilityUse } from "../../types";
import type { Failure } from "./failure";

/** The Console agent, linked; a project the Workspace doesn't know as one of
 *  its agents is named by its project. */
export function AgentName({ agent }: { agent: CapabilityAgent }) {
  if (agent.known && agent.agent_id)
    return <Link to={`/agents/${agent.agent_id}`}>{agent.name || agent.agent_id}</Link>;
  return (
    <span className="muted">
      unknown agent (project <code>{agent.project_id ?? "?"}</code>)
    </span>
  );
}

const agentVersion = (a: CapabilityAgent) =>
  [a.agent_version != null && `v${a.agent_version}`, a.agent_state].filter(Boolean).join(" · ") || "—";

/** `refresh` changes whenever the Capability's versions do: a publish or a
 *  rollback moves what every following agent resolves to. */
export function UsedBy({ name, refresh }: { name: string; refresh: unknown }) {
  const [uses, setUses] = useState<CapabilityUse[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setError("");
    api<ApiResponse<CapabilityUse[]>>(`/capabilities/${encodeURIComponent(name)}/agents`)
      .then((r) => live && setUses(r.data))
      .catch((e) => live && setError(errMsg(e, "Could not load the agents using it.")));
    return () => {
      live = false;
    };
  }, [name, refresh]);

  return (
    <section aria-labelledby="used-by-h" style={{ marginTop: 18 }}>
      <h3 id="used-by-h">Used by</h3>
      {error && <p role="alert" className="error-text">{error}</p>}
      {uses === null && !error && <p className="muted">Loading…</p>}
      {uses?.length === 0 && <p className="muted">No agent lists {name}. It can be deleted.</p>}
      {uses && uses.length > 0 && (
        <table className="list">
          <thead>
            <tr><th>Agent</th><th>Agent version</th><th>Runs</th><th>Pinned</th></tr>
          </thead>
          <tbody>
            {uses.map((u, i) => (
              <tr key={`${u.project_id}:${u.turncall_agent_id}:${i}`}>
                <td><AgentName agent={u} /></td>
                <td className="nowrap">{agentVersion(u)}</td>
                <td className="num nowrap">
                  {u.resolved_version != null ? `v${u.resolved_version}` : <span className="muted">nothing: its pin no longer runs</span>}
                </td>
                <td>{u.pinned ? "Pinned" : <span className="muted">Follows live</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const inUseAgents = (failure: Failure): CapabilityAgent[] | null => {
  if (failure.reason !== "capability_in_use") return null;
  const agents = (failure.body as { agents?: unknown } | undefined)?.agents;
  return Array.isArray(agents) ? (agents as CapabilityAgent[]) : [];
};

/** A refused delete, naming the agents that still list the Capability; null
 *  for any other refusal. */
export function InUseNote({ failure }: { failure: Failure }) {
  const agents = inUseAgents(failure);
  if (agents === null) return null;
  return (
    <div className="callout error" role="alert">
      <strong>Not deleted.</strong> {failure.message}
      {agents.length > 0 && (
        <ul style={{ margin: "6px 0 0" }}>
          {agents.map((a, i) => (
            <li key={`${a.project_id}:${a.turncall_agent_id}:${i}`}>
              <AgentName agent={a} /> <span className="muted">({agentVersion(a)})</span>
            </li>
          ))}
        </ul>
      )}
      <p style={{ marginBottom: 0 }}>Remove it from each agent's skills and save, then delete it.</p>
    </div>
  );
}

export const isInUse = (failure: Failure | null): boolean => failure?.reason === "capability_in_use";

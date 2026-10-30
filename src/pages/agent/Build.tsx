import { useEffect, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { api } from "../../api";
import type { ApiResponse, PhoneNumber } from "../../types";
import { ROUTING_LABELS } from "../PhoneNumbersList";
import { useAgent } from "./AgentPage";
import AgentCompliance from "./AgentCompliance";
import ConfigTab from "./ConfigTab";
import KnowledgeSearch from "./KnowledgeSearch";
import KnowledgeTab from "./KnowledgeTab";
import TakeawaysTab from "./TakeawaysTab";
import TestTab from "./TestTab";
import { SECTIONS, setupChecks, type SectionId, type SetupCheck } from "./sections";

// Build: config sections on the left, the selected one in the middle, and a
// test panel that stays open on the right — edit, save, call, without a tab hop.
export default function Build() {
  const { agentId, draft, dirty } = useAgent();
  const { section } = useParams();
  const [number, setNumber] = useState<PhoneNumber | null | undefined>(undefined); // undefined = loading
  const [scenarios, setScenarios] = useState<number | null>(null);

  useEffect(() => {
    api<ApiResponse<{ phone_numbers: PhoneNumber[] }>>("/phone-numbers")
      .then((r) => setNumber(r.data.phone_numbers.find((n) => n.agent_id === agentId) ?? null))
      .catch(() => setNumber(null));
    api(`/agents/${agentId}/eval-scenarios`)
      .then((r) => setScenarios((r.data || []).length))
      .catch(() => setScenarios(0));
  }, [agentId]);

  const checks = number === undefined || scenarios === null ? null : setupChecks(agentId, draft, Boolean(number), scenarios);
  const left = checks?.filter((c) => !c.done).length;
  // A new agent lands on its Setup checklist; a set-up one on its prompt.
  const named = SECTIONS.find((s) => s.id === section)?.id;
  const current = named ?? (checks === null ? null : left ? "setup" : "prompt");

  const tools = (draft.tools?.length || 0) + (draft.custom_tools?.length || 0) + (draft.mcp_servers?.length || 0)
    + (draft.workspace_mcp_servers?.length || 0) + (draft.integrations?.length || 0);
  const counts: Partial<Record<SectionId, string | number>> = {
    setup: checks ? `${checks.length - left!}/${checks.length}` : "",
    tools: tools || "",
    guardrails: draft.guardrails?.prohibited_topics?.length || "",
    skills: draft.skills?.length || "",
    avatar: draft.avatar?.enabled ? draft.avatar.provider : "Off",
  };

  return (
    <>
      <nav aria-label="Configuration" className="wb-sections">
        <div className="wb-kicker">Configuration</div>
        {SECTIONS.map((s) => (
          <NavLink key={s.id} to={`/agents/${agentId}/build/${s.id}`}
            className={current === s.id ? "on" : ""} aria-current={current === s.id ? "true" : undefined}>
            {s.title}
            {dirty.includes(s.id) ? (
              <span className="dot" aria-label="Edited" />
            ) : (
              counts[s.id] !== undefined && counts[s.id] !== "" && <span className="muted">{counts[s.id]}</span>
            )}
          </NavLink>
        ))}
        <div className="wb-number">
          <span className="wb-kicker">Answers on</span>
          {number ? (
            <>
              <span className="mono">{number.e164}</span>
              <span>{ROUTING_LABELS[number.routing_type] ?? number.routing_type}</span>
            </>
          ) : number === null ? (
            <Link to="/phone-numbers/new">Add a number</Link>
          ) : (
            <span className="muted">…</span>
          )}
        </div>
      </nav>

      <div className="wb-editor">
        {current === null ? (
          <p className="muted">Loading…</p>
        ) : current === "setup" ? (
          <Setup checks={checks} />
        ) : current === "knowledge" ? (
          <KnowledgeTab />
        ) : current === "takeaways" ? (
          <TakeawaysTab />
        ) : current === "compliance" ? (
          <AgentCompliance agentId={agentId} />
        ) : (
          <ConfigTab section={current} />
        )}
      </div>

      {current === "knowledge" && (
        // The section's search, beside its documents. Test stays mounted
        // underneath, hidden, so a chat under way survives the visit.
        <aside aria-label="Search documents" className="wb-test">
          <h2>Search documents</h2>
          <KnowledgeSearch />
        </aside>
      )}
      <aside aria-label="Test" className="wb-test" hidden={current === "knowledge"}>
        <h2>Test</h2>
        {dirty.length > 0 && (
          <p className="callout warn">
            A test runs the saved agent. Your {dirty.length} unsaved change{dirty.length > 1 ? "s are" : " is"} not in it yet.
          </p>
        )}
        <TestTab />
      </aside>
    </>
  );
}

function Setup({ checks }: { checks: SetupCheck[] | null }) {
  return (
    <section aria-labelledby="setup-h">
      <h2 id="setup-h">Setup</h2>
      <p className="muted lead">
        {checks?.every((c) => c.done)
          ? "Everything a working agent needs is in place."
          : "What a working agent has that this one does not yet."}
      </p>
      <ul className="setup-list">
        {(checks || []).map((c) => (
          <li key={c.label} className={c.done ? "done" : ""}>
            <span className="tick" role="img" aria-label={c.done ? "Done" : "To do"} />
            {c.label}
            {!c.done && <Link to={c.to}>{c.fix}</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}

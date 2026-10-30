// A new skill: version 1, a draft until it is published. The Workspace's
// skill library is made by the first one (builder-api ADR-0029).
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import type { ApiResponse, SkillVersion } from "../../types";
import { SkillForm } from "./SkillForm";
import { blankDraft, NAME_PATTERN, toBody, type Draft } from "./draft";
import { FailureNote, failureOf, type Failure } from "./failure";

export default function NewSkill() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  const name = draft.name.trim();
  const nameOk = NAME_PATTERN.test(name);
  const complete = nameOk && draft.description.trim() && draft.instructions.trim();

  async function create() {
    const out = toBody(draft);
    if ("errors" in out) {
      setFailure({ message: "Some fields can't be sent as they are.", errors: out.errors });
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await api<ApiResponse<SkillVersion>>("/skills", {
        method: "POST",
        body: JSON.stringify(out.body),
      });
      navigate(`/skills/${encodeURIComponent(r.data.name)}?version=${r.data.id}`, {
        state: { notice: `Created ${r.data.name} v${r.data.version} as a draft. Publish it to make it live.` },
      });
    } catch (e) {
      setFailure(failureOf(e, "Could not create the skill."));
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h2>New skill</h2>
          <p>Starts as a draft: no call runs it until it is published.</p>
        </div>
      </div>
      {failure && <FailureNote failure={failure} toolCount={draft.tools.length} withName />}
      <SkillForm value={draft} withName editable={!busy} errors={failure?.errors ?? []}
        onChange={(d) => setDraft(d)} />
      {name && !nameOk && (
        <p className="error-text">A name is lowercase letters, digits and underscores, starting with a letter or underscore.</p>
      )}
      <div className="modal-actions">
        <Link to="/skills" className="btn">Cancel</Link>
        <button type="button" className="btn btn-primary" disabled={busy || !complete} onClick={() => void create()}>
          {busy ? "Creating…" : "Create draft"}
        </button>
      </div>
    </div>
  );
}

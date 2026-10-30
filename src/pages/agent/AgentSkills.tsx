// The Workspace skills this agent may load mid-call (builder-api #133):
// `skills` in its config, each a skill name and, when pinned, one version
// id, and `max_loaded_skills`, how many it holds at once. Saved with the rest of
// the config by the page's Save; TurnCall checks every entry then, and its
// refusal of one is shown on that entry.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type FieldError } from "../../api";
import { errMsg } from "../../errors";
import type {
  ApiResponse,
  SkillDetail,
  SkillList,
  SkillRef,
  SkillSummary,
  SkillVersion,
} from "../../types";
import { errorsAt, errorsUnder } from "../skills/fieldErrors";
import { NumberField } from "./SettingFields";

// TurnCall's default when the agent sets none.
export const DEFAULT_MAX_LOADED = 3;

type Props = {
  skills: SkillRef[];
  maxLoaded: number | undefined;
  isS2S: boolean;
  editable: boolean;
  /** The last save's refused fields; `skills[i]` is shown on entry i. */
  errors: FieldError[];
  onSkills: (next: SkillRef[]) => void;
  onMaxLoaded: (next: number | "") => void;
};

// What a pin can name: a version calls have run or run now. Never a draft —
// TurnCall refuses a pin on one, since it never runs.
const pinnable = (v: SkillVersion) => v.state === "published" || v.state === "archived";

export function AgentSkills({ skills, maxLoaded, isS2S, editable, errors, onSkills, onMaxLoaded }: Props) {
  const [published, setPublished] = useState<SkillSummary[] | null>(null);
  const [listError, setListError] = useState("");
  // Each listed skill's pinnable versions, newest first; a string is why
  // they could not be read.
  const [versions, setVersions] = useState<Record<string, SkillVersion[] | string>>({});
  const [adding, setAdding] = useState("");

  useEffect(() => {
    api<ApiResponse<SkillList>>("/skills")
      .then((r) => setPublished(r.data.skills.filter((c) => c.live)))
      .catch((e) => setListError(errMsg(e, "Could not load the workspace's skills.")));
  }, []);

  const names = skills.map((s) => s.skill).join("\n");
  useEffect(() => {
    let live = true;
    for (const name of names ? names.split("\n") : []) {
      if (versions[name] !== undefined) continue;
      api<ApiResponse<SkillDetail>>(`/skills/${encodeURIComponent(name)}`)
        .then((r) => live && setVersions((vs) => ({ ...vs, [name]: r.data.versions.filter(pinnable) })))
        .catch((e) => live && setVersions((vs) => ({ ...vs, [name]: errMsg(e, "Could not load its versions.") })));
    }
    return () => {
      live = false;
    };
    // `versions` is read only to skip names already asked for, so not a dependency.
  }, [names]);

  const listed = new Set(skills.map((s) => s.skill));
  const addable = (published ?? []).filter((c) => !listed.has(c.name));
  const summary = (name: string) => published?.find((c) => c.name === name);

  const pin = (i: number, versionId: string) =>
    onSkills(skills.map((s, n) => (n === i ? (versionId ? { skill: s.skill, version_id: versionId } : { skill: s.skill }) : s)));

  const add = () => {
    const name = adding || addable[0]?.name;
    if (!name) return;
    onSkills([...skills, { skill: name }]);
    setAdding("");
  };

  return (
    <>
      {isS2S && (
        <p className="callout warn">
          A speech-to-speech agent loads no skills: TurnCall skips them on its calls. They apply
          if the agent goes back to the cascade pipeline.
        </p>
      )}
      {listError && <p role="alert" className="error-text">{listError}</p>}

      {skills.length === 0 && <p className="muted">This agent has no skills.</p>}
      {skills.length > 0 && (
      <ul className="mcp-list">
        {skills.map((entry, i) => {
          const c = summary(entry.skill);
          const vs = versions[entry.skill];
          const problems = errorsUnder(errors, `skills[${i}]`);
          const orphanPin = entry.version_id && Array.isArray(vs) && !vs.some((v) => v.id === entry.version_id);
          return (
            <li key={`${entry.skill}:${i}`} aria-label={`Skill ${entry.skill}`}>
              <div className="mcp-main" style={{ flex: 1, minWidth: 0 }}>
                <Link to={`/skills/${encodeURIComponent(entry.skill)}`} className="mono">{entry.skill}</Link>
                {c && <span className="muted">{c.description}</span>}
                {published && !c && (
                  <span className="error-text" style={{ display: "block" }}>
                    Not a published skill: TurnCall refuses to save it. Publish it, or remove it here.
                  </span>
                )}
                {typeof vs === "string" && <span className="error-text" style={{ display: "block" }}>{vs}</span>}
                {problems.map((m) => (
                  <p key={m} className="error-text">{m}</p>
                ))}
              </div>
              <select className="input" style={{ width: "auto" }} aria-label={`Version of ${entry.skill}`}
                value={entry.version_id ?? ""} disabled={!editable || !Array.isArray(vs)}
                onChange={(e) => pin(i, e.target.value)}>
                <option value="">Follow the live version{c?.live ? ` (now v${c.live.version})` : ""}</option>
                {orphanPin && <option value={entry.version_id}>Pinned to a version no longer listed</option>}
                {Array.isArray(vs) &&
                  vs.map((v) => (
                    <option key={v.id} value={v.id}>
                      Pin to v{v.version}{v.state === "published" ? " (live)" : " (archived)"}
                    </option>
                  ))}
              </select>
              {editable && (
                <button type="button" className="btn" aria-label={`Remove ${entry.skill}`}
                  onClick={() => onSkills(skills.filter((_, n) => n !== i))}>
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
      )}

      {editable && published && addable.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0 0" }}>
          <select className="input" style={{ width: "auto" }} aria-label="Skill to add"
            value={adding || addable[0].name} onChange={(e) => setAdding(e.target.value)}>
            {addable.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={add}>Add skill</button>
        </div>
      )}
      {published && published.length === 0 && (
        <p className="hint">
          This workspace has no published skills yet. <Link to="/skills">Write one</Link>, publish it,
          and it can be added here.
        </p>
      )}
      <p className="hint">
        Following the live version, the agent gets each new publish on its next call. A pinned one stays on its
        version until you change it.
      </p>

      <div style={{ maxWidth: 260 }}>
        <NumberField id="cap-max-loaded" label="Loaded at once" value={maxLoaded} min={1} max={10}
          placeholder={String(DEFAULT_MAX_LOADED)} disabled={!editable}
          hint={`1–10. Empty means ${DEFAULT_MAX_LOADED}. Loading one more puts down the one loaded longest ago.`}
          onChange={onMaxLoaded} />
        {errorsAt(errors, "max_loaded_skills").map((m) => (
          <p key={m} className="error-text">{m}</p>
        ))}
      </div>
    </>
  );
}

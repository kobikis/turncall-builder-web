// One Capability: its versions, the one open (a draft to edit, or a published
// or archived one to read), and what can be done with it.
//
// A version's life is TurnCall's: only a draft is edited, publishing it
// archives the live one, and rolling back makes an archived one live again —
// for every agent that follows the Capability, on its next call.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../api";
import { useAuth } from "../../auth";
import { canEdit } from "../../roles";
import { fmtTime } from "../../dates";
import { errMsg } from "../../errors";
import type { ApiResponse, CapabilityDetail, CapabilityState, CapabilityVersion } from "../../types";
import { CapabilityForm } from "./CapabilityForm";
import { fromVersion, sameDraft, toBody, type Draft } from "./draft";
import { FailureNote, failureOf, type Failure } from "./failure";

export const STATE_LABELS: Record<CapabilityState, string> = {
  published: "Live",
  draft: "Draft",
  archived: "Archived",
};
export const STATE_BADGES: Record<CapabilityState, string> = {
  published: "running",
  draft: "degraded",
  archived: "stopped",
};

const bodyOf = (v: CapabilityVersion) => ({
  name: v.name,
  description: v.description,
  instructions: v.instructions,
  tools: v.tools,
});

export default function CapabilityView() {
  const { name = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role);

  const [detail, setDetail] = useState<CapabilityDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string>(
    () => (location.state as { notice?: string } | null)?.notice ?? "",
  );
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<ApiResponse<CapabilityDetail>>(`/capabilities/${encodeURIComponent(name)}`)
        .then((r) => {
          setDetail(r.data);
          return r.data;
        })
        .catch((e) => {
          setLoadError(errMsg(e, "Could not load the Capability."));
          return null;
        }),
    [name],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const versions = detail?.versions ?? [];
  const draftVersion = versions.find((v) => v.state === "draft");
  const liveVersion = versions.find((v) => v.state === "published");
  // The version asked for, else the one being worked on, else the one calls run.
  const selected =
    versions.find((v) => v.id === params.get("version")) ?? draftVersion ?? liveVersion ?? versions[0];

  const saved = useMemo(() => (selected ? fromVersion(selected) : null), [selected]);
  useEffect(() => {
    setDraft(saved);
    setFailure(null);
  }, [saved]);

  const open = (id: string) => setParams({ version: id }, { replace: true });

  // Runs one action: the refusal on the form, a notice on success.
  async function run(fallback: string, fn: () => Promise<string>) {
    setBusy(true);
    setFailure(null);
    setNotice("");
    try {
      setNotice(await fn());
    } catch (e) {
      setFailure(failureOf(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  const dirty = selected?.state === "draft" && !sameDraft(draft, saved);

  // A draft's edits, sent; throws the form's own refusal when they can't be.
  async function putDraft(v: CapabilityVersion): Promise<void> {
    if (!draft) return;
    const out = toBody(draft);
    if ("errors" in out) {
      throw new ApiError("Some fields can't be sent as they are.", 0, { errors: out.errors });
    }
    const { description, instructions, tools } = out.body;
    await api(`/capability-versions/${v.id}`, {
      method: "PUT",
      body: JSON.stringify({ description, instructions, tools }),
    });
  }

  const saveDraft = (v: CapabilityVersion) =>
    run("Could not save the draft.", async () => {
      await putDraft(v);
      await load();
      return `Saved v${v.version}. It is still a draft: no call runs it until it is published.`;
    });

  const publish = (v: CapabilityVersion) =>
    run("Could not publish.", async () => {
      if (dirty) await putDraft(v);
      await api(`/capability-versions/${v.id}/publish`, { method: "POST" });
      await load();
      open(v.id);
      return `Published v${v.version}. Every agent following ${name} gets it on its next call.`;
    });

  const rollback = (v: CapabilityVersion) =>
    run("Could not roll back.", async () => {
      await api(`/capability-versions/${v.id}/rollback`, { method: "POST" });
      await load();
      open(v.id);
      return `v${v.version} is live again, for every agent following ${name}.`;
    });

  const fromLive = (live: CapabilityVersion) =>
    run("Could not start a new version.", async () => {
      const r = await api<ApiResponse<CapabilityVersion>>("/capabilities", {
        method: "POST",
        body: JSON.stringify(bodyOf(live)),
      });
      await load();
      open(r.data.id);
      return `Started v${r.data.version} from v${live.version}. Edit it, then publish.`;
    });

  async function remove(v: CapabilityVersion) {
    const last = versions.length === 1;
    if (!confirm(last ? `Delete ${name}? It is its only version, so the Capability goes too.` : `Delete v${v.version} of ${name}?`))
      return;
    await run("Could not delete the version.", async () => {
      await api(`/capability-versions/${v.id}`, { method: "DELETE" });
      if (last) {
        navigate("/capabilities", { state: { notice: `Deleted ${name}.` } });
        return "";
      }
      setParams({}, { replace: true });
      await load();
      return `Deleted v${v.version}.`;
    });
  }

  if (loadError) return <p role="alert" className="error-text">{loadError}</p>;
  if (!detail || !selected || !draft) return <p className="muted">Loading…</p>;

  const isDraft = selected.state === "draft";
  const warnings = selected.warnings ?? [];

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <p className="muted" style={{ margin: 0 }}>
            <Link to="/capabilities">Capabilities</Link> /
          </p>
          <h2 className="mono">{name}</h2>
          <p>
            {liveVersion
              ? `Live: v${liveVersion.version}. Agents that list ${name} without a pin run it.`
              : "Not published: no agent can list it yet."}
          </p>
        </div>
        {editable && liveVersion && !draftVersion && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void fromLive(liveVersion)}>
            New version from live
          </button>
        )}
      </div>

      {notice && <div className="callout info" role="status">{notice}</div>}
      {!editable && (
        <p className="muted">Changing a Capability is an editor's action. You can read every version.</p>
      )}
      {editable && draftVersion && liveVersion && selected.id !== draftVersion.id && (
        <p className="hint">
          v{draftVersion.version} is a draft.{" "}
          <button type="button" className="link-button" onClick={() => open(draftVersion.id)}>Open it</button>{" "}
          to change {name}.
        </p>
      )}

      <h3>Versions</h3>
      <table className="list">
        <thead>
          <tr><th>Version</th><th>State</th><th>Updated</th><th>Published</th><th></th></tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id} aria-current={v.id === selected.id ? "true" : undefined}>
              <td className="num">
                <button type="button" className="link-button" onClick={() => open(v.id)}
                  aria-label={`Open v${v.version}`}>
                  v{v.version}
                </button>
                {v.id === selected.id && <span className="muted"> · open</span>}
              </td>
              <td><span className={`badge ${STATE_BADGES[v.state]}`}>{STATE_LABELS[v.state]}</span></td>
              <td className="nowrap">{fmtTime(v.updated_at)}</td>
              <td className="nowrap">{fmtTime(v.published_at)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {editable && v.state === "archived" && (
                  <button type="button" className="btn" disabled={busy} onClick={() => void rollback(v)}
                    aria-label={`Roll back to v${v.version}`}>
                    Roll back
                  </button>
                )}
                {editable && (
                  <button type="button" className="btn btn-danger-ghost" disabled={busy} style={{ marginLeft: 6 }}
                    onClick={() => void remove(v)} aria-label={`Delete v${v.version}`}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section aria-label={`Version ${selected.version}`} style={{ marginTop: 18 }}>
        <h3>
          v{selected.version}{" "}
          <span className={`badge ${STATE_BADGES[selected.state]}`}>{STATE_LABELS[selected.state]}</span>
        </h3>
        {!isDraft && editable && (
          <p className="hint" style={{ marginTop: 0 }}>
            {selected.state === "published"
              ? "The live version is not edited: start a new version from it."
              : "An archived version is read-only. Roll back to make it live again."}
          </p>
        )}
        {warnings.map((w) => (
          <p key={w.code + w.message} className="callout warn">{w.message}</p>
        ))}
        {failure && <FailureNote failure={failure} toolCount={draft.tools.length} />}
        <CapabilityForm value={draft} editable={editable && isDraft && !busy} errors={failure?.errors ?? []}
          onChange={setDraft} />
        {editable && isDraft && (
          <div className="modal-actions">
            <button type="button" className="btn" disabled={busy || !dirty} onClick={() => void saveDraft(selected)}>
              Save draft
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void publish(selected)}>
              {dirty ? "Save and publish" : "Publish"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

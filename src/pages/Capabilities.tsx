// The Workspace's Capabilities (builder-api ADR-0029): what its agents can load
// mid-call — instructions and webhook tools, written once, versioned, and shared
// by every agent that lists them. TurnCall calls them skills; on the Console
// "Skill" is the Builder's own guidance (the Skills page), so these keep their
// own name.
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { canEdit } from "../roles";
import { errMsg } from "../errors";
import SkeletonRows from "../components/SkeletonRows";
import type { ApiResponse, CapabilityLibrary, CapabilityList, CapabilitySummary } from "../types";

export default function Capabilities() {
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role);
  const location = useLocation();
  const [items, setItems] = useState<CapabilitySummary[] | null>(null); // null = loading
  const [error, setError] = useState("");
  const notice = (location.state as { notice?: string } | null)?.notice ?? "";

  useEffect(() => {
    api<ApiResponse<CapabilityList>>("/capabilities")
      .then((r) => setItems(r.data.capabilities))
      .catch((e) => setError(errMsg(e, "Could not load Capabilities.")));
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Capabilities</h2>
          <p>
            What this workspace's agents can load mid-call: instructions and tools, written once and
            shared. An agent sees each one's name and when to use it, and loads it when it needs it.
          </p>
        </div>
        {editable && (
          <Link to="/capabilities/new" className="btn btn-primary">+ New Capability</Link>
        )}
      </div>

      {notice && <div className="callout info" role="status">{notice}</div>}
      {error && <p role="alert" className="error-text">{error}</p>}
      <LibraryLinks editable={editable} />

      <table className="list" aria-busy={items === null}>
        <thead>
          <tr><th>Name</th><th>When to use it</th><th>Live</th><th>Draft</th></tr>
        </thead>
        <tbody>
          {items === null && !error && <SkeletonRows columns={4} />}
          {items?.map((c) => (
            <tr key={c.name}>
              <td className="mono" style={{ whiteSpace: "nowrap" }}>
                <Link to={`/capabilities/${encodeURIComponent(c.name)}`}>{c.name}</Link>
              </td>
              <td className="hint">{c.description}</td>
              <td className="num nowrap">
                {c.live ? `v${c.live.version}` : <span className="muted">Not published</span>}
              </td>
              <td className="nowrap">
                {c.draft && <span className="badge degraded">Draft v{c.draft.version}</span>}
              </td>
            </tr>
          ))}
          {items?.length === 0 && (
            <tr>
              <td colSpan={4} className="muted" style={{ padding: 16 }}>
                No Capabilities yet.{editable ? " Create one, publish it, then add it to an agent on its Build page." : ""}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Every agent's project is linked to the library so it can resolve the
// Workspace's Capabilities; a link that failed leaves that agent without them,
// silently, unless it is shown. Best-effort: an unreadable report shows nothing.
function LibraryLinks({ editable }: { editable: boolean }) {
  const [report, setReport] = useState<CapabilityLibrary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ApiResponse<CapabilityLibrary>>("/capability-library")
      .then((r) => setReport(r.data))
      .catch(() => {});
  }, []);

  if (!report?.library || report.complete) return null;
  const unlinked = report.links.filter((l) => l.state !== "linked");

  async function retry() {
    setBusy(true);
    setError("");
    try {
      const r = await api<ApiResponse<CapabilityLibrary>>("/capability-library/links", { method: "POST" });
      setReport(r.data);
    } catch (e) {
      setError(errMsg(e, "Could not link them."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="callout warn" role="status">
      {unlinked.length || "Some"} {unlinked.length === 1 ? "agent is" : "agents are"} not linked to the
      Capability library yet, so {unlinked.length === 1 ? "it" : "they"} can't load Capabilities
      {unlinked.length > 0 && <>: {unlinked.map((l) => l.name || l.project_id).join(", ")}</>}.
      {editable && (
        <button type="button" className="btn" style={{ marginLeft: 8 }} disabled={busy} onClick={() => void retry()}>
          {busy ? "Linking…" : "Retry"}
        </button>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

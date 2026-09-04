import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth";

// Switch between Workspaces (changes the active X-Workspace-Id every request
// carries) and create a new one (#28). Switching/creating navigates to /agents so
// the view can't show the previous Workspace's data — the Layout also remounts
// its content on the active-id change, so pages re-fetch under the new scope.
export default function WorkspaceSwitcher() {
  const { workspaces, activeWorkspaceId, setActiveWorkspace, createWorkspace } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchTo(id: string) {
    if (id === activeWorkspaceId) return;
    setActiveWorkspace(id);
    navigate("/agents");
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await createWorkspace(trimmed); // creates + switches into it (as admin)
      setName("");
      setCreating(false);
      navigate("/agents");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create workspace");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ws-switcher">
      <label className="section-label" htmlFor="ws-select">
        Workspace
      </label>
      <select
        id="ws-select"
        className="input"
        aria-label="Active workspace"
        value={activeWorkspaceId ?? ""}
        onChange={(e) => switchTo(e.target.value)}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>

      {creating ? (
        <form className="ws-new" onSubmit={create}>
          <input
            className="input"
            placeholder="New workspace name"
            aria-label="New workspace name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error && <div className="error-text">{error}</div>}
          <div className="ws-new-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "…" : "Create"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setCreating(false);
                setName("");
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="link-btn" type="button" onClick={() => setCreating(true)}>
          + New workspace
        </button>
      )}
    </div>
  );
}

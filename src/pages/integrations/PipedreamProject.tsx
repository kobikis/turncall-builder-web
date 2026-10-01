import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";

// The Workspace's own Pipedream project. Without one, Connected apps live in
// the platform's project; with one, in the Workspace's — its billing, its
// limits. The client secret is write-only, like every other credential here.

type Status = {
  connected: boolean;
  client_id?: string;
  project_id?: string;
  environment?: string;
  platform_project: boolean;
};

const EMPTY = { client_id: "", client_secret: "", project_id: "", environment: "production" };

export function PipedreamProject({ isAdmin, onChange }: { isAdmin: boolean; onChange: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      api("/integrations/pipedream")
        .then((r) => setStatus(r.data && typeof r.data.connected === "boolean" ? r.data : null))
        .catch(() => setStatus(null)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const close = () => {
    setOpen(false);
    setForm(EMPTY);
    setError("");
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      close();
      await load();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  const complete = form.client_id.trim() && form.client_secret.trim() && form.project_id.trim();
  const runsOn = status.connected
    ? `This workspace's project ${status.project_id} (${status.environment}).`
    : status.platform_project
      ? "Apps connect through the platform's Pipedream project."
      : "No Pipedream project — connect one to use Connected apps.";

  const field = (name: keyof typeof EMPTY, label: string, opts: { secret?: boolean; placeholder?: string } = {}) => (
    <div className="field">
      <label htmlFor={`pd-${name}`}>{label}</label>
      <input
        id={`pd-${name}`}
        className="input"
        type={opts.secret ? "password" : "text"}
        autoComplete={opts.secret ? "new-password" : "off"}
        spellCheck={false}
        placeholder={opts.placeholder}
        value={form[name]}
        onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
      />
    </div>
  );

  return (
    <>
      <div className="integration-card provider-card" data-testid="pipedream-card">
        <div className="head">
          <span className="app-tile" aria-hidden="true" style={{ background: "#2a2a2a" }}>P</span>
          <div className="title">
            <div className="name">Pipedream</div>
            <div className="roles">Project behind Connected apps</div>
          </div>
        </div>
        <p className={`desc${!status.connected && !status.platform_project ? " danger" : ""}`}>{runsOn}</p>
        <div className="foot">
          <span
            className={`badge app-status ${status.connected ? "connected" : status.platform_project ? "platform" : "missing"}`}
          >
            {status.connected ? "Connected" : status.platform_project ? "Platform project" : "Not configured"}
          </span>
          {isAdmin && (
            <button type="button" className="btn" onClick={() => setOpen(true)}>
              {status.connected ? "Manage" : "Connect"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => !busy && close()}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Pipedream project" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="app-tile" aria-hidden="true" style={{ background: "#2a2a2a" }}>P</span>
              <div className="title">
                <div className="name">Pipedream</div>
                <div className="roles">Your own project for Connected apps</div>
              </div>
              <button type="button" className="modal-close" aria-label="Close" onClick={close}>×</button>
            </div>
            <p className="modal-status">{runsOn}</p>
            <p className="hint">
              From pipedream.com → your project → Settings → OAuth clients. Apps connected
              afterwards live in this project. The client secret is stored encrypted and
              never shown again.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (complete) void run(() => api("/integrations/pipedream", { method: "PUT", body: JSON.stringify(form) }));
              }}
            >
              {field("client_id", "Client ID", { placeholder: status.client_id })}
              {field("client_secret", "Client secret", { secret: true })}
              {field("project_id", "Project ID", { placeholder: status.project_id || "proj_…" })}
              <div className="field">
                <label htmlFor="pd-environment">Environment</label>
                <select
                  id="pd-environment"
                  className="input"
                  value={form.environment}
                  onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value }))}
                >
                  <option value="production">production</option>
                  <option value="development">development</option>
                </select>
              </div>
              <div className="modal-actions">
                {status.connected && (
                  <button
                    type="button"
                    className="btn btn-danger-ghost"
                    disabled={busy}
                    style={{ marginRight: "auto" }}
                    onClick={() => void run(() => api("/integrations/pipedream", { method: "DELETE" }))}
                  >
                    Disconnect
                  </button>
                )}
                <button type="button" className="btn" onClick={close}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy || !complete}>
                  {busy ? "Checking…" : status.connected ? "Replace" : "Connect project"}
                </button>
              </div>
            </form>
            {error && (
              <div className="callout error" role="alert">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

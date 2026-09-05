import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { canEdit } from "../../roles";
import { useAgent } from "./AgentPage";

// Push this agent's generated backend to a repo the user already owns (ADR-0013).
// Nothing here creates a repository: owner, repo, branch and path are chosen
// from what their own token can see.

type Connection = { id: string; github_login: string; expires_at: string | null };
type Repo = { owner: string; name: string; full_name: string; default_branch: string; private: boolean };
type Link = {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  connection_id: string | null;
  pushed_at: string | null;
  push_error: string | null;
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : "never";

// A token that lapses turns into silently failing pushes, so warn before it does.
const expiryWarning = (iso: string | null): string | null => {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "This token has expired — pushes will fail until you reconnect.";
  if (days <= 14) return `This token expires in ${days} day${days === 1 ? "" : "s"}.`;
  return null;
};

export default function CodeTab() {
  const { agentId } = useAgent();
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role);

  const [conn, setConn] = useState<Connection | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [form, setForm] = useState({ full_name: "", branch: "", path: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      api("/github/connection").then((r) => r.data).catch(() => null),
      api(`/agents/${agentId}/github`).then((r) => r.data).catch(() => null),
    ]).then(([c, l]) => {
      setConn(c);
      setLink(l);
      if (l) setForm({ full_name: `${l.owner}/${l.repo}`, branch: l.branch, path: l.path });
      setLoaded(true);
    });
  }, [agentId]);

  // Repo list is only fetchable once connected, and only useful while linking.
  useEffect(() => {
    if (!conn) return;
    api("/github/repos").then((r) => setRepos(r.data)).catch(() => setRepos([]));
  }, [conn]);

  useEffect(() => {
    const [owner, name] = form.full_name.split("/");
    if (!owner || !name) return setBranches([]);
    api(`/github/repos/${owner}/${name}/branches`)
      .then((r) => setBranches(r.data))
      .catch(() => setBranches([]));
  }, [form.full_name]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const [owner, repo] = form.full_name.split("/");
      const r = await api(`/agents/${agentId}/github`, {
        method: "PUT",
        body: JSON.stringify({ owner, repo, branch: form.branch, path: form.path.trim() }),
      });
      setLink(r.data);
      setNotice("Linked. Push when you're ready.");
    });

  const push = () =>
    run(async () => {
      const r = await api(`/agents/${agentId}/github/push`, { method: "POST" });
      setLink({ ...(r.data as Link), push_error: null });
      setNotice(`Pushed ${String(r.data.commit).slice(0, 7)}.`);
    });

  const unlink = () =>
    run(async () => {
      await api(`/agents/${agentId}/github`, { method: "DELETE" });
      setLink(null);
      setForm({ full_name: "", branch: "", path: "" });
      setNotice("Unlinked. The repository on GitHub is unchanged.");
    });

  if (!loaded) return <p className="muted">Loading…</p>;

  // Not connected: this is a per-user credential, so nobody can do it for you.
  if (!conn)
    return (
      <div className="card">
        <h3>Push this agent's code to GitHub</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          The generated backend — tool handlers, Dockerfile, compose file — plus
          <code>agent.json</code> with this agent's prompt, model, voice and
          tools, can be pushed to a repository you already own, so you can run it
          yourself instead of only through the builder. Nothing is ever created
          on your GitHub: you choose the repository, branch and folder.
        </p>
        <p style={{ fontSize: 13 }}>
          <Link to="/settings/github">Connect your GitHub account</Link> to get
          started. It's per-person, so this connects yours and not the workspace's.
        </p>
      </div>
    );

  const warning = expiryWarning(conn.expires_at);
  const diverged = !!link?.push_error;
  const orphaned = !!link && link.connection_id === null;
  const repoUrl = link ? `https://github.com/${link.owner}/${link.repo}` : "";
  const treeUrl = link ? `${repoUrl}/tree/${link.branch}${link.path ? `/${link.path}` : ""}` : "";

  return (
    <div className="card">
      <h3>GitHub</h3>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 14px" }}>
        Connected as <strong>{conn.github_login}</strong>
        {conn.expires_at && ` · token expires ${when(conn.expires_at)}`}
      </p>
      {warning && <p className="callout warn">{warning}</p>}

      {orphaned && (
        <p className="callout warn">
          The GitHub connection that owned this link is gone. Nothing was deleted —
          relink below to take it over with your own connection.
        </p>
      )}

      {diverged && (
        <div className="callout warn">
          <strong>Not pushed.</strong> {link!.push_error}
          <div style={{ marginTop: 6 }}>
            <a href={treeUrl} target="_blank" rel="noreferrer">
              Review the changes on GitHub
            </a>{" "}
            — reconcile them there, then push again. The builder will not
            overwrite them.
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 2, minWidth: 240 }}>
          <label htmlFor="gh-repo">Repository</label>
          <select
            id="gh-repo"
            className="input"
            disabled={!editable || busy}
            value={form.full_name}
            onChange={(e) => {
              const r = repos.find((x) => x.full_name === e.target.value);
              setForm((f) => ({
                ...f,
                full_name: e.target.value,
                branch: r?.default_branch || f.branch,
              }));
            }}
          >
            <option value="">Select a repository…</option>
            {repos.map((r) => (
              <option key={r.full_name} value={r.full_name}>
                {r.full_name}
                {r.private ? " (private)" : ""}
              </option>
            ))}
          </select>
          {repos.length === 0 && (
            <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
              No repositories with write access. Your token needs
              “Contents: Read and write”, and an organisation may still need to
              approve it.
            </p>
          )}
        </div>

        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="gh-branch">Branch</label>
          <input
            id="gh-branch"
            className="input"
            list="gh-branches"
            disabled={!editable || busy}
            value={form.branch}
            placeholder="main"
            onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
          />
          <datalist id="gh-branches">
            {branches.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="field">
        <label htmlFor="gh-path">Folder in the repository (optional)</label>
        <input
          id="gh-path"
          className="input"
          disabled={!editable || busy}
          value={form.path}
          placeholder="agents/my-agent"
          onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
        />
        <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
          Leave empty to use the repository root. Set a folder to keep several
          agents in one repository — only that folder is ever written to.
        </p>
      </div>

      {error && <p role="alert" className="error-text">{error}</p>}
      {notice && !error && <p className="muted">{notice}</p>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <button
          className="btn primary"
          disabled={!editable || busy || !form.full_name || !form.branch}
          onClick={save}
        >
          {link ? "Update link" : "Link repository"}
        </button>
        {link && (
          <>
            <button className="btn" disabled={!editable || busy || orphaned} onClick={push}>
              Push now
            </button>
            <button className="btn" disabled={!editable || busy} onClick={unlink}>
              Unlink
            </button>
          </>
        )}
      </div>

      {link && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          A push writes the backend code and <code>agent.json</code> — the
          prompt, model, voice and tools. Editing the prompt or model changes
          <code> agent.json</code> only; the code changes when tools do.
        </p>
      )}

      {link && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
          <a href={treeUrl} target="_blank" rel="noreferrer">
            {link.owner}/{link.repo}
            {link.path ? `/${link.path}` : ""}
          </a>{" "}
          on <code>{link.branch}</code> · last pushed {when(link.pushed_at)}
        </p>
      )}

      {link && (
        <details style={{ marginTop: 14 }}>
          <summary className="muted" style={{ fontSize: 12.5, cursor: "pointer" }}>
            Run it yourself
          </summary>
          <pre style={{ fontSize: 12, marginTop: 8 }}>
{`git clone ${repoUrl}.git
cd ${link.repo}${link.path ? `/${link.path}` : ""}
cp .env.example .env     # then fill it in
docker compose up -d --build`}
          </pre>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Secrets are never pushed — <code>.env.example</code> lists what to
            fill in, and secrets inside <code>agent.json</code> are redacted.
          </p>
        </details>
      )}
    </div>
  );
}

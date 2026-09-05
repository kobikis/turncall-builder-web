import { useEffect, useState } from "react";
import { api } from "../api";

// Per-user GitHub connection (ADR-0013). Not a workspace setting: the credential
// is authorized by a person against an account they control, and pushes are
// attributed to them on GitHub. No role gate — you can only connect your own.

type Connection = { id: string; github_login: string; expires_at: string | null };

const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

export default function GitHubSettings() {
  const [conn, setConn] = useState<Connection | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = () =>
    api("/github/connection")
      .then((r) => setConn(r.data))
      .catch(() => setConn(null))
      .finally(() => setLoaded(true));

  useEffect(() => {
    load();
  }, []);

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api("/github/connection", {
        method: "POST",
        body: JSON.stringify({ token: token.trim() }),
      });
      setConn(r.data);
      setToken("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/github/connection", { method: "DELETE" });
      setConn(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  };

  const expiry = conn?.expires_at ? new Date(conn.expires_at) : null;
  const days = expiry ? Math.ceil((expiry.getTime() - Date.now()) / 86_400_000) : null;

  return (
    <section>
      <h2>GitHub</h2>
      <p className="muted" style={{ fontSize: 13, maxWidth: 620 }}>
        Connect your GitHub account to push an agent's generated backend to a
        repository you already own. This is yours, not the workspace's — pushes
        are made and attributed as you.
      </p>

      {!loaded ? (
        <p className="muted">Loading…</p>
      ) : conn ? (
        <div className="card" style={{ maxWidth: 620 }}>
          <p style={{ margin: 0 }}>
            Connected as <strong>{conn.github_login}</strong>
          </p>
          {expiry && (
            <p
              className={days !== null && days <= 14 ? "callout warn" : "muted"}
              style={{ fontSize: 12.5, marginTop: 8 }}
            >
              {days !== null && days < 0
                ? "This token has expired — pushes are failing until you reconnect."
                : `Token expires ${expiry.toLocaleDateString()}${
                    days !== null && days <= 14 ? ` — in ${days} day${days === 1 ? "" : "s"}` : ""
                  }.`}
            </p>
          )}
          {error && <p role="alert" className="error-text">{error}</p>}
          <button className="btn" disabled={busy} onClick={disconnect} style={{ marginTop: 10 }}>
            Disconnect
          </button>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            Disconnecting stops pushes. Nothing is deleted on GitHub, and the
            repositories your agents are linked to stay exactly as they are.
          </p>
        </div>
      ) : (
        <div className="card" style={{ maxWidth: 620 }}>
          <div className="field">
            <label htmlFor="gh-token">Fine-grained personal access token</label>
            <input
              id="gh-token"
              className="input"
              type="password"
              autoComplete="off"
              placeholder="github_pat_…"
              value={token}
              disabled={busy}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          {error && <p role="alert" className="error-text">{error}</p>}
          <button
            className="btn primary"
            disabled={busy || token.trim().length < 8}
            onClick={connect}
          >
            Connect
          </button>

          <ol className="muted" style={{ fontSize: 12.5, marginTop: 14, paddingLeft: 18 }}>
            <li>
              <a href={TOKEN_URL} target="_blank" rel="noreferrer">
                Create a fine-grained token
              </a>{" "}
              on GitHub.
            </li>
            <li>Under <strong>Repository access</strong>, select the repositories agents will push to.</li>
            <li>
              Under <strong>Permissions → Repository</strong>, set{" "}
              <strong>Contents: Read and write</strong>. Nothing else is needed.
            </li>
            <li>Generate it, copy it once, and paste it above.</li>
          </ol>
          <p className="muted" style={{ fontSize: 12.5 }}>
            The token is stored encrypted and never shown again. If the
            repositories belong to an organisation, it may need approving under
            that organisation's third-party access settings before it works.
          </p>
        </div>
      )}
    </section>
  );
}

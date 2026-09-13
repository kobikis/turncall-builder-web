import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { atLeast } from "../roles";

// Connecting an app for the Workspace (ADR-0018, ADR-0021). Authorizing one had
// no Console surface at all before this page: the Connect Link had to be minted
// by hand, and the callback redirected the browser to a route that did not
// exist. This is that route.
//
// Which agent uses an app, and when it runs, is chosen per agent — see
// ConnectedApps on the agent's Configuration tab. Connecting is a Workspace act;
// attaching is an agent one, and putting both here would need an agent picker.

export type CatalogApp = { app: string; name: string; tools: string[] };
export type ConnectedAccount = {
  id: string;
  app: string;
  name?: string;
  account_name?: string | null;
};

/** Catalog apps first, then anything connected that the catalog no longer lists. */
export function rows(
  catalog: CatalogApp[],
  connected: ConnectedAccount[],
): CatalogApp[] {
  const known = new Map(catalog.map((a) => [a.app, a]));
  const out = [...catalog];
  for (const account of connected) {
    // An app dropped from the catalog is still connected at Pipedream, and an
    // admin needs to be able to revoke it — hiding it would strand the grant.
    if (!known.has(account.app)) out.push({ app: account.app, name: account.app, tools: [] });
  }
  return out;
}

export default function Integrations() {
  const { activeWorkspace } = useAuth();
  const isAdmin = atLeast(activeWorkspace?.role, "admin");
  const [params, setParams] = useSearchParams();

  const [catalog, setCatalog] = useState<CatalogApp[]>([]);
  const [connected, setConnected] = useState<ConnectedAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(
    () =>
      Promise.all([
        api("/integrations/catalog").then((r) => setCatalog(r.data)),
        api("/integrations").then((r) => setConnected(r.data)),
      ])
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load integrations."))
        .finally(() => setLoaded(true)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The callback lands here with its outcome in the query string. Read it once
  // and strip it, so a refresh doesn't re-announce a connection made minutes ago.
  useEffect(() => {
    const connectedApp = params.get("connected");
    const failed = params.get("error");
    if (!connectedApp && !failed) return;
    if (connectedApp) setNotice(`${connectedApp} connected.`);
    if (failed) setError(failed);
    setParams({}, { replace: true });
  }, [params, setParams]);

  const connect = async (app: string) => {
    setBusy(app);
    setError("");
    try {
      const r = await api("/integrations/connect", {
        method: "POST",
        body: JSON.stringify({ app }),
      });
      // Pipedream hosts the authorization page; it sends the admin back to the
      // callback, which sends them back here.
      window.location.href = r.data.connect_link_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the connection.");
      setBusy("");
    }
  };

  const disconnect = async (account: ConnectedAccount) => {
    setBusy(account.app);
    setError("");
    setNotice("");
    try {
      await api(`/integrations/${account.id}`, { method: "DELETE" });
      // Agents that had it attached keep the attachment: the grant is gone, so
      // the tools stop working, but silently rewriting every agent's config from
      // here would be a much larger surprise than a tool that stops answering.
      setConnected((cs) => cs.filter((c) => c.id !== account.id));
      setNotice(`${account.app} disconnected.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setBusy("");
    }
  };

  if (!loaded) return null;

  return (
    <div className="page">
      <h1>Integrations</h1>
      <p className="muted" style={{ maxWidth: 620 }}>
        Apps this workspace has authorized. Connecting one here makes it
        available to every agent; each agent chooses whether to use it during a
        call, after one, or both — on its Configuration tab.
      </p>

      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="error">{error}</p>}

      {!isAdmin && (
        <p className="muted" style={{ fontSize: 12.5 }}>
          Connecting and disconnecting is an admin action. You can see what is
          connected and attach it to an agent.
        </p>
      )}

      {rows(catalog, connected).map((row) => {
        const account = connected.find((c) => c.app === row.app);
        return (
          <div
            key={row.app}
            style={{ border: "1px solid var(--border, #ddd)", padding: 12, marginBottom: 10 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ flex: 1 }}>{row.name}</strong>
              {account ? (
                <>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {account.account_name || account.name || "connected"}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      disabled={busy === row.app}
                      onClick={() => void disconnect(account)}
                    >
                      Disconnect
                    </button>
                  )}
                </>
              ) : (
                isAdmin && (
                  <button
                    type="button"
                    disabled={busy === row.app}
                    onClick={() => void connect(row.app)}
                  >
                    {busy === row.app ? "Opening…" : "Connect"}
                  </button>
                )
              )}
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
              {row.tools.length > 0
                ? row.tools.map((t) => t.replace(`${row.app}-`, "")).join(", ")
                : "No longer in the catalog — it can be disconnected, not attached."}
            </p>
          </div>
        );
      })}

      <p className="muted" style={{ fontSize: 12.5, marginTop: 16 }}>
        Credentials stay at Pipedream. This console never sees them, and an
        agent's configuration never carries one — they are minted per call and
        expire within the hour.
      </p>
    </div>
  );
}

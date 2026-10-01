import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { atLeast } from "../roles";
import { AppHead, describe, type CatalogApp } from "../apps";
import { McpRegistry } from "./integrations/McpRegistry";
import { ProviderAccounts } from "./integrations/ProviderAccounts";
import { TwilioAccount } from "./integrations/TwilioAccount";

// Everything this Workspace is connected to, on one page (ADR-0023): its own
// provider accounts, its registered MCP servers, and its Connected apps. The
// two kinds of credential stay visibly different — a provider key is a
// long-lived secret this console stores; a Connected app's is held by the
// provider and minted per call.
//
// Connecting an app for the Workspace (ADR-0018, ADR-0021). Authorizing one had
// no Console surface at all before this page: the Connect Link had to be minted
// by hand, and the callback redirected the browser to a route that did not
// exist. This is that route.
//
// Which agent uses an app, and when it runs, is chosen per agent — see
// ConnectedApps on the agent's Configuration tab. Connecting is a Workspace act;
// attaching is an agent one, and putting both here would need an agent picker.

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

  const all = rows(catalog, connected);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Integrations</h2>
          <p>Everything this workspace is connected to.</p>
        </div>
      </div>

      <ProviderAccounts isAdmin={isAdmin} />
      <TwilioAccount isAdmin={isAdmin} />
      <McpRegistry isAdmin={isAdmin} />

      <section aria-labelledby="connected-apps" className="int-section">
      <h3 id="connected-apps">Connected apps</h3>
      <p className="lead">
        Apps this workspace has authorized. Connect one here and every agent
        can use it — each agent chooses whether it runs during a call, after
        one, or both, on its Configuration tab. Unlike a provider key, nothing
        is stored here: the app's credentials are held by Pipedream and minted
        for each call.
      </p>

      {notice && <div className="callout info" role="status">{notice}</div>}
      {error && <div className="callout error" role="alert">{error}</div>}

      {!isAdmin && (
        <p className="muted">
          Connecting and disconnecting is an admin action. You can see what is
          connected and attach it to an agent.
        </p>
      )}

      <div className="integration-grid">
        {all.map((row) => {
          const account = connected.find((c) => c.app === row.app);
          const unlisted = row.tools.length === 0;
          return (
            <div className="integration-card" key={row.app}>
              {/* The status is the header's job now. Repeating it in the footer
                  cost the row that a long account name needed. */}
              <AppHead row={row} status={account ? "connected" : "disconnected"} />
              <div className="name">{row.name}</div>
              <p className="desc">{describe(row)}</p>
              <div className="foot">
                {account && (
                  <span className="account-name" title={account.account_name || account.name || ""}>
                    {account.account_name || account.name || ""}
                  </span>
                )}
                {account
                  ? isAdmin && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={busy === row.app}
                        onClick={() => void disconnect(account)}
                      >
                        Disconnect
                      </button>
                    )
                  : isAdmin &&
                    !unlisted && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy === row.app}
                        onClick={() => void connect(row.app)}
                      >
                        {busy === row.app ? "Opening…" : "Connect"}
                      </button>
                    )}
              </div>
            </div>
          );
        })}
      </div>

   <p className="hint">
        Credentials stay at Pipedream. This console never sees them, and an
        agent's configuration never carries one — they are minted for each call
        and expire within the hour.
      </p>
      </section>
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";

// The Workspace's Twilio account (ADR-0023). Connected once here and chosen on
// the add-number form, instead of pasting a token for every number. Saving it
// again re-sends the new pair to every number bound with it.

export type TwilioStatus = {
  connected: boolean;
  account_sid?: string;
  last4?: string;
  validation?: { status?: string; checked?: string; detail?: string };
  numbers: { id: string; e164: string }[];
};

type Resent = { id: string; e164: string; state: string; error?: string | null };

export function TwilioAccount({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<TwilioStatus | null>(null);
  const [sid, setSid] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resent, setResent] = useState<Resent[]>([]);

  const load = useCallback(
    () =>
      api("/integrations/twilio")
        .then((r) => setStatus(r.data && typeof r.data.connected === "boolean" ? r.data : null))
        .catch(() => setStatus(null)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api("/integrations/twilio", {
        method: "PUT",
        body: JSON.stringify({ account_sid: sid.trim() || status?.account_sid, auth_token: token }),
      });
      setResent(r.data.numbers || []);
      setToken("");
      setSid("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the Twilio account.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/integrations/twilio", { method: "DELETE" });
      setResent([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  const failed = resent.filter((n) => n.state === "failed");
  const v = status.validation;

  return (
    <section aria-labelledby="twilio-account">
      <h3 id="twilio-account">Telephony</h3>
      <div className="integration-card" data-testid="twilio-card" style={{ maxWidth: 520 }}>
        <div className="head">
          <span className="app-tile" aria-hidden="true" style={{ background: "#f22f46" }}>T</span>
          <span className={`badge app-status ${status.connected ? "connected" : "disconnected"}`}>
            {status.connected ? "Workspace account" : "Not connected"}
          </span>
        </div>
        <div className="name">Twilio</div>
        <p className="desc">
          {status.connected
            ? `Account ${status.account_sid} · token ····${status.last4}. ${status.numbers.length} number(s) bound with it.`
            : "Connect your Twilio account once, then pick its numbers when adding a phone number."}
        </p>
        {status.connected && v?.status === "valid" && (
          <p className="desc">Accepted by Twilio's number list — checked, not a live call.</p>
        )}
        {status.connected && v?.status === "unverified" && (
          <p className="desc">Could not be checked ({v.detail}). Saved anyway.</p>
        )}
        {failed.length > 0 && (
          <div className="callout warn">
            Not updated: {failed.map((n) => `${n.e164} (${n.error})`).join("; ")}. Save again to retry.
          </div>
        )}
        {isAdmin && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              className="input"
              aria-label="Twilio Account SID"
              autoComplete="off"
              spellCheck={false}
              placeholder={status.account_sid || "ACxxxxxxxx"}
              value={sid}
              onChange={(e) => setSid(e.target.value)}
              style={{ marginBottom: 4 }}
            />
            <input
              className="input"
              type="password"
              aria-label="Twilio Auth Token"
              autoComplete="new-password"
              placeholder={status.connected ? "Paste a new token to rotate it" : "Twilio Auth Token"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <div className="foot" style={{ marginTop: 6 }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !token.trim() || !(sid.trim() || status.account_sid)}
              >
                {busy ? "Checking…" : status.connected ? "Replace" : "Connect Twilio"}
              </button>
              {status.connected && (
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void disconnect()}>
                  Disconnect
                </button>
              )}
            </div>
          </form>
        )}
        {error && (
          <div className="callout error" role="alert">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}

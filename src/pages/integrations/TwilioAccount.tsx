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
  const [open, setOpen] = useState(false);

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
      const numbers: Resent[] = r.data.numbers || [];
      setResent(numbers);
      setToken("");
      setSid("");
      if (!numbers.some((n) => n.state === "failed")) setOpen(false);
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
      setOpen(false);
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

  const close = () => {
    setOpen(false);
    setSid("");
    setToken("");
    setError("");
  };

  return (
    <section aria-labelledby="twilio-account" className="int-section">
      <h3 id="twilio-account">Telephony</h3>
      <p className="lead">
        Connect your Twilio account once, then pick its numbers when adding a phone
        number instead of entering credentials each time.
      </p>
      <div className="integration-grid">
        <div className="integration-card provider-card" data-testid="twilio-card">
          <div className="head">
            <span className="app-tile" aria-hidden="true" style={{ background: "#f22f46" }}>T</span>
            <div className="title">
              <div className="name">Twilio</div>
              <div className="roles">Phone numbers · Voice · SMS</div>
            </div>
          </div>
          <p className="desc">
            {status.connected
              ? `Account ${status.account_sid?.slice(0, 10)}… · token ····${status.last4} · ${status.numbers.length} number(s)`
              : "Numbers use per-number credentials or the platform's account."}
          </p>
          {failed.length > 0 && (
            <p className="desc meta danger">
              Not updated: {failed.map((n) => n.e164).join(", ")}
            </p>
          )}
          <div className="foot">
            <span className={`badge app-status ${status.connected ? "connected" : "disconnected"}`}>
              {status.connected ? "Connected" : "Not connected"}
            </span>
            {isAdmin && (
              <button type="button" className="btn" onClick={() => setOpen(true)}>
                {status.connected ? "Manage" : "Connect"}
              </button>
            )}
          </div>
        </div>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => !busy && close()}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Twilio account" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="app-tile" aria-hidden="true" style={{ background: "#f22f46" }}>T</span>
              <div className="title">
                <div className="name">Twilio</div>
                <div className="roles">Phone numbers · Voice · SMS</div>
              </div>
              <button type="button" className="modal-close" aria-label="Close" onClick={close}>×</button>
            </div>
            {status.connected && (
              <p className="modal-status">
                Account {status.account_sid} · token ····{status.last4}. {status.numbers.length} number(s) bound with it.
              </p>
            )}
            {status.connected && v?.status === "valid" && (
              <p className="hint">Accepted by Twilio's number list — checked, not a live call.</p>
            )}
            {status.connected && v?.status === "unverified" && (
              <p className="hint">Could not be checked ({v.detail}). Saved anyway.</p>
            )}
            {failed.length > 0 && (
              <div className="callout warn">
                Not updated: {failed.map((n) => `${n.e164} (${n.error})`).join("; ")}. Save again to retry.
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="field">
                <label htmlFor="tw-sid">Account SID</label>
                <input
                  id="tw-sid"
                  className="input"
                  aria-label="Twilio Account SID"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={status.account_sid || "ACxxxxxxxx"}
                  value={sid}
                  onChange={(e) => setSid(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="tw-token">Auth Token</label>
                <input
                  id="tw-token"
                  className="input"
                  type="password"
                  aria-label="Twilio Auth Token"
                  autoComplete="new-password"
                  placeholder={status.connected ? "Paste a new token to rotate it" : "Twilio Auth Token"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <p className="hint" style={{ margin: "4px 0 0" }}>
                  Stored encrypted and never shown again. Saving a new token updates every number bound with it.
                </p>
              </div>
              <div className="modal-actions">
                {status.connected && (
                  <button
                    type="button"
                    className="btn btn-danger-ghost"
                    disabled={busy}
                    onClick={() => void disconnect()}
                    style={{ marginRight: "auto" }}
                  >
                    Disconnect
                  </button>
                )}
                <button type="button" className="btn" onClick={close}>Cancel</button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || !token.trim() || !(sid.trim() || status.account_sid)}
                >
                  {busy ? "Checking…" : status.connected ? "Replace" : "Connect Twilio"}
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
    </section>
  );
}

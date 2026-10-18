import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { canEdit, isAdmin } from "../roles";
import Uid from "../components/Uid";
import { CARRIER_LABELS, type Carrier } from "./PhoneNumberForm";
import { Agent, ApiResponse, PendingPurchase, PhoneNumber, PhoneNumberRelease } from "../types";

type Num = PhoneNumber & PendingPurchase;

// What an open in-page confirmation is for. A routed row is unbound, an unassigned
// one is removed from the list (#103); neither gives the number back to the carrier.
// Release does, and can't be undone (#101).
type Pending = { id: string; kind: "unbind" | "remove" | "release" };

const carrierOf = (n: Num) => (n.carrier || "twilio") as Carrier;
// Only Twilio and Telnyx numbers are bought and released; an Asterisk number
// belongs to the PBX's dialplan.
const releasable = (n: Num) => n.routing_type === "none" && carrierOf(n) !== "asterisk";
const carrierName = (n: Num) => CARRIER_LABELS[carrierOf(n)] ?? n.carrier;
// Where the number lives once TurnCall lets go of it: unbinding or removing keeps paying.
const staysText = (n: Num) =>
  carrierOf(n) === "asterisk"
    ? "The number stays in your PBX's dialplan."
    : `The number stays on your ${carrierName(n)} account and is still billed.`;

export const ROUTING_LABELS: Record<string, string> = {
  agent: "agent",
  agent_call_init: "agent + caller info",
  webhook: "custom call-init",
  none: "unassigned",
};

export default function PhoneNumbersList() {
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role); // viewers get a read-only list
  const admin = isAdmin(activeWorkspace?.role); // only admins release (builder-api #108)
  const [numbers, setNumbers] = useState<Num[] | null>(null); // null = loading
  const [names, setNames] = useState<Record<string, string>>({}); // agent_id -> name
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [sortDesc, setSortDesc] = useState(false); // by number, ascending default
  const [pending, setPending] = useState<Pending | null>(null); // the one open confirmation
  const [typed, setTyped] = useState(""); // release: the E.164 typed to confirm
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(""); // shown inside the open confirmation
  const [notice, setNotice] = useState("");

  const load = () =>
    api<ApiResponse<{ phone_numbers: Num[] }>>("/phone-numbers")
      .then((r) => setNumbers(r.data.phone_numbers))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // Resolve agent_id -> name so the Target column shows names, not UUIDs.
    api<ApiResponse<{ agents: Agent[] }>>("/agents")
      .then((r) => setNames(Object.fromEntries(r.data.agents.map((a) => [a.agent_id, a.name]))))
      .catch(() => {}); // best-effort — falls back to the id
  }, []);

  // Filter by id, number or label, then sort by number (e164).
  const visible = (numbers || [])
    .filter((n) => {
      const s = q.trim().toLowerCase();
      return (
        !s ||
        n.e164.toLowerCase().includes(s) ||
        n.id.toLowerCase().includes(s) ||
        (n.label || "").toLowerCase().includes(s)
      );
    })
    .sort((a, b) => (sortDesc ? -1 : 1) * a.e164.localeCompare(b.e164));

  function ask(id: string, kind: Pending["kind"]) {
    setPending({ id, kind });
    setTyped("");
    setActionError("");
    setNotice("");
  }
  const dismiss = () => {
    setPending(null);
    setActionError("");
  };

  // Unbind (routed) or remove from the list (unassigned): the same DELETE.
  async function unbind(n: Num) {
    setBusy(true);
    setActionError("");
    try {
      await api(`/phone-numbers/${n.id}`, { method: "DELETE" });
      setPending(null);
      setNotice(
        n.routing_type === "none"
          ? `Removed ${n.e164} from the list. ${staysText(n)}`
          : `Unbound ${n.e164}. ${staysText(n)}`,
      );
      load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Couldn't do that; try again.");
    } finally {
      setBusy(false);
    }
  }

  async function release(n: Num) {
    setBusy(true);
    setActionError("");
    try {
      const r = await api<ApiResponse<PhoneNumberRelease>>(`/phone-numbers/${n.id}/release`, {
        method: "POST",
        body: JSON.stringify({ confirm: typed.trim() }),
      });
      setPending(null);
      setNotice(`Released ${r.data?.released ?? n.e164} back to ${carrierName(n)}.`);
      load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Release failed.");
    } finally {
      setBusy(false);
    }
  }

  function confirmation(n: Num, kind: Pending["kind"]) {
    if (kind === "release") {
      const matches = typed.trim() === n.e164;
      return (
        <div className="callout error" role="alertdialog" aria-label={`Release ${n.e164}`}>
          <strong>Release {n.e164} back to {carrierName(n)}? This can't be undone.</strong>
          <p>
            {carrierName(n)} takes the number back and billing for it stops. {carrierName(n)} may sell it to
            someone else, so you may never get it back.
          </p>
          <label htmlFor={`release-${n.id}`} style={{ display: "block", marginTop: 10 }}>
            Type {n.e164} to confirm
          </label>
          <input
            id={`release-${n.id}`}
            className="input"
            style={{ maxWidth: 240 }}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={n.e164}
          />
          {actionError && <p role="alert" className="error-text">{actionError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={dismiss}>Cancel</button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || !matches}
              onClick={() => void release(n)}
            >
              {busy ? "Releasing…" : "Release number permanently"}
            </button>
          </div>
        </div>
      );
    }
    const routed = kind === "unbind";
    return (
      <div
        className="callout warn"
        role="alertdialog"
        aria-label={routed ? `Unbind ${n.e164}` : `Remove ${n.e164} from the list`}
      >
        <strong>{routed ? `Unbind ${n.e164}?` : `Remove ${n.e164} from the list?`}</strong>
        <p>
          {routed
            ? "Calls to this number stop reaching TurnCall and it leaves this list. "
            : "TurnCall forgets this number and it leaves this list. "}
          {staysText(n)} You can add it again later.
        </p>
        {!routed && carrierOf(n) !== "asterisk" && (
          <p>
            {admin
              ? "To stop paying for it, use Release instead."
              : "To stop paying for it, a workspace admin can release it."}
          </p>
        )}
        {actionError && <p role="alert" className="error-text">{actionError}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={dismiss}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void unbind(n)}>
            {busy ? "Working…" : routed ? "Unbind number" : "Remove from list"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Phone Numbers</h2>
          <p>Twilio, Telnyx and PBX numbers routed to agents or call-init endpoints.</p>
        </div>
        {editable && (
          <Link to="/phone-numbers/new" className="btn btn-primary">+ Add number</Link>
        )}
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
      {notice && <p role="status" className="hint">{notice}</p>}
      <input
        className="input"
        style={{ marginBottom: 10, maxWidth: 360 }}
        aria-label="Search phone numbers by id or number"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by number, label or id (e.g. +1415… or Support)"
      />
      <table className="list">
        <thead>
          <tr>
            <th>
              <button
                className="row-toggle"
                onClick={() => setSortDesc((v) => !v)}
                aria-label={`Sort by number, ${sortDesc ? "descending" : "ascending"} — click to reverse`}
              >
                Number <span className="caret" aria-hidden="true">{sortDesc ? "▾" : "▴"}</span>
              </button>
            </th>
            <th>ID</th><th>Carrier</th><th>Routing</th><th>Target</th><th>SMS</th><th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((n) => (
            <Fragment key={n.id}>
              <tr>
                <td className="num" style={{ fontWeight: 500 }}>
                  {editable ? <Link to={`/phone-numbers/${n.id}/edit`}>{n.e164}</Link> : n.e164}
                  {n.label && <div className="hint" style={{ fontWeight: 400 }}>{n.label}</div>}
                  {n.purchase_status === "pending" && (
                    <div className="hint" style={{ fontWeight: 400 }}>ordered, waiting on Telnyx</div>
                  )}
                </td>
                <td><Uid id={n.id} label="phone_number_id" /></td>
                <td>{CARRIER_LABELS[(n.carrier || "twilio") as Carrier] ?? n.carrier}</td>
                <td>{ROUTING_LABELS[n.routing_type] || n.routing_type}</td>
                <td className="hint">
                  {n.agent_id ? (
                    <Link to={`/agents/${n.agent_id}`}>
                      {names[n.agent_id] || `${n.agent_id.slice(0, 8)}…`}
                    </Link>
                  ) : n.routing_type === "webhook" ? (
                    <code style={{ overflowWrap: "anywhere" }}>{n.server_url}</code>
                  ) : (
                    <span className="muted">unassigned</span>
                  )}
                </td>
                <td>{n.sms_enabled ? "on" : <span className="muted">off</span>}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {editable && (
                    <button
                      type="button"
                      className="btn btn-danger-ghost"
                      style={{ padding: "3px 10px" }}
                      onClick={() => ask(n.id, n.routing_type === "none" ? "remove" : "unbind")}
                    >
                      {n.routing_type === "none" ? "Remove from list" : "Unbind"}
                    </button>
                  )}
                  {admin && releasable(n) && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ padding: "3px 10px", marginLeft: 6 }}
                      onClick={() => ask(n.id, "release")}
                    >
                      Release
                    </button>
                  )}
                </td>
              </tr>
              {pending?.id === n.id && (
                <tr>
                  <td colSpan={7}>{confirmation(n, pending.kind)}</td>
                </tr>
              )}
            </Fragment>
          ))}
          {numbers === null && !error && (
            <tr><td colSpan={7} className="muted" style={{ padding: 16 }}>Loading…</td></tr>
          )}
          {numbers?.length === 0 && (
            <tr><td colSpan={7} className="muted" style={{ padding: 16 }}>No numbers bound yet.</td></tr>
          )}
          {numbers && numbers.length > 0 && visible.length === 0 && (
            <tr><td colSpan={7} className="muted" style={{ padding: 16 }}>No numbers match “{q}”.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

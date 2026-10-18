import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { errMsg } from "../errors";
import { useAuth } from "../auth";
import { canEdit, isAdmin } from "../roles";
import Uid from "../components/Uid";
import { CARRIER_LABELS, type Carrier } from "./PhoneNumberForm";
import { Agent, ApiResponse, PhoneNumber, PhoneNumberRelease, ReleaseCheck } from "../types";

type Num = PhoneNumber;

// What an open in-page confirmation is for. A routed row is unbound, an unassigned
// one is removed from the list (#103); neither gives the number back to the carrier.
// Release does, and can't be undone (#101). Before it opens, builder-api checks the
// number can be released (#111): "checking" while it asks, "blocked" when it can't
// be, with the reason (`failed` when the check itself failed).
type Pending =
  | { id: string; kind: "unbind" | "remove" | "release" | "checking" }
  | { id: string; kind: "blocked"; text: string; failed: boolean };

const carrierOf = (n: Num) => (n.carrier || "twilio") as Carrier;
const carrierName = (n: Num) => CARRIER_LABELS[carrierOf(n)] ?? n.carrier;
// A Twilio number with no Twilio account stored with it. Every row without a
// Twilio token reads "platform", so it counts on Twilio rows only (builder-web
// #105). It may be on the workspace's account or TurnCall's platform account:
// only the release check finds out (#111).
const noStoredTwilio = (n: Num) => carrierOf(n) === "twilio" && n.twilio_credentials === "platform";
// Bought on Telnyx, but the order hasn't finished: builder-api refuses to release it yet.
const ordering = (n: Num) => n.purchase_status === "pending";
// Release is offered on unassigned Twilio and Telnyx numbers, once any order has
// finished; an Asterisk number belongs to the PBX's dialplan. Whether this one can
// be released is builder-api's release check, asked when Release is clicked (#111).
const offersRelease = (n: Num) =>
  n.routing_type === "none" && (carrierOf(n) === "twilio" || carrierOf(n) === "telnyx") && !ordering(n);
// Where the number lives once TurnCall lets go of it: unbinding or removing keeps paying.
const staysText = (n: Num) =>
  carrierOf(n) === "asterisk"
    ? "The number stays in your PBX's dialplan."
    : noStoredTwilio(n)
      ? "No Twilio account is stored with this number yet."
      : `The number stays on your ${carrierName(n)} account and is still billed.`;
// Said in the confirmation of a Remove, or of an Unbind of a number with no stored
// Twilio account: what letting go of it doesn't do, and how it stops being paid for.
const stopPayingText = (n: Num, admin: boolean, routed: boolean) =>
  noStoredTwilio(n)
    ? `${routed ? "Unbinding" : "Removing"} it doesn't release it.` +
      (routed
        ? ""
        : admin
          ? " Release checks which Twilio account it's on."
          : " A workspace admin can use Release, which checks which Twilio account it's on.")
    : ordering(n)
      ? `To stop paying for it, ${admin ? "release it" : "a workspace admin can release it"} once Telnyx finishes the order.`
      : admin
        ? "To stop paying for it, use Release instead."
        : "To stop paying for it, a workspace admin can release it.";

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
  // Rows with a request running. A request finishing only touches its own row:
  // the confirmation may have moved to another row meanwhile.
  // "check" is a release check (#111), "act" any other request.
  const [running, setRunning] = useState<Record<string, "check" | "act">>({});
  const [actionError, setActionError] = useState<{ id: string; text: string } | null>(null);
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

  function ask(id: string, kind: Exclude<Pending["kind"], "blocked">) {
    setPending({ id, kind });
    setTyped("");
    setActionError(null);
    setNotice("");
  }
  const dismiss = () => {
    setPending(null);
    setActionError(null);
  };

  // Runs one row's request: closes that row's confirmation on success, shows the
  // refusal in it on failure, and leaves any other row's confirmation alone.
  async function act(n: Num, send: () => Promise<string>, fallback: string) {
    setRunning((r) => ({ ...r, [n.id]: "act" }));
    setError("");
    setActionError((a) => (a?.id === n.id ? null : a));
    try {
      const done = await send();
      setPending((p) => (p?.id === n.id ? null : p));
      setNotice(done);
      load();
    } catch (e) {
      setActionError({ id: n.id, text: errMsg(e, fallback) });
    } finally {
      setRunning(({ [n.id]: _, ...rest }) => rest);
    }
  }

  // Unbind (routed) or remove from the list (unassigned): the same DELETE.
  const unbind = (n: Num) =>
    act(
      n,
      async () => {
        await api(`/phone-numbers/${n.id}`, { method: "DELETE" });
        return n.routing_type === "none"
          ? `Removed ${n.e164} from the list. ${staysText(n)}`
          : `Unbound ${n.e164}. ${staysText(n)}`;
      },
      "Couldn't do that; try again.",
    );

  // Release asks builder-api first whether the number can be released (#111),
  // with the row busy meanwhile. Only a yes opens the typed confirmation. The
  // answer lands only if this row's check is still what's open.
  async function checkRelease(n: Num) {
    ask(n.id, "checking");
    setRunning((r) => ({ ...r, [n.id]: "check" }));
    setError("");
    let next: Pending;
    try {
      const r = await api<ApiResponse<ReleaseCheck>>(`/phone-numbers/${n.id}/release-check`);
      next = r.data.releasable
        ? { id: n.id, kind: "release" }
        : {
            id: n.id,
            kind: "blocked",
            text: r.data.detail || `${n.e164} can't be released.`,
            failed: false,
          };
      // The check corrects a Twilio row it found on the workspace's account.
      if (r.data.twilio_credentials !== n.twilio_credentials) load();
    } catch (e) {
      next = {
        id: n.id,
        kind: "blocked",
        text: errMsg(e, "Couldn't check whether this number can be released; try again."),
        failed: true,
      };
    } finally {
      setRunning(({ [n.id]: _, ...rest }) => rest);
    }
    setPending((p) => (p?.id === n.id && p.kind === "checking" ? next : p));
  }

  const release = (n: Num, confirm: string) =>
    act(
      n,
      async () => {
        const r = await api<ApiResponse<PhoneNumberRelease>>(`/phone-numbers/${n.id}/release`, {
          method: "POST",
          body: JSON.stringify({ confirm }),
        });
        return `Released ${r.data?.released ?? n.e164} back to ${carrierName(n)}.`;
      },
      "Release failed.",
    );

  function confirmation(n: Num, p: Pending) {
    const busy = !!running[n.id];
    const failed = actionError?.id === n.id ? actionError.text : "";
    if (p.kind === "blocked") {
      // Not releasable, or the check failed: the reason, and no confirmation.
      return (
        <div className={`callout ${p.failed ? "error" : "warn"}`} role="group" aria-label={`Release ${n.e164}`}>
          {p.failed ? (
            <p role="alert" className="error-text" style={{ marginTop: 0 }}>{p.text}</p>
          ) : (
            <p role="status" style={{ marginTop: 0 }}>{p.text}</p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={dismiss}>Close</button>
          </div>
        </div>
      );
    }
    if (p.kind === "release") {
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
          {failed && <p role="alert" className="error-text">{failed}</p>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={dismiss} disabled={busy}>Cancel</button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || !matches}
              onClick={() => void release(n, typed.trim())}
            >
              {busy ? "Releasing…" : "Release number permanently"}
            </button>
          </div>
        </div>
      );
    }
    const routed = p.kind === "unbind";
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
        {carrierOf(n) !== "asterisk" && (!routed || noStoredTwilio(n)) && <p>{stopPayingText(n, admin, routed)}</p>}
        {failed && <p role="alert" className="error-text">{failed}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={dismiss} disabled={busy}>Cancel</button>
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
                  {ordering(n) && (
                    <div className="hint" style={{ fontWeight: 400 }}>ordered, waiting on Telnyx</div>
                  )}
                </td>
                <td><Uid id={n.id} label="phone_number_id" /></td>
                <td>{carrierName(n)}</td>
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
                      disabled={!!running[n.id]}
                      onClick={() => ask(n.id, n.routing_type === "none" ? "remove" : "unbind")}
                    >
                      {n.routing_type === "none" ? "Remove from list" : "Unbind"}
                    </button>
                  )}
                  {admin && offersRelease(n) && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ padding: "3px 10px", marginLeft: 6 }}
                      disabled={!!running[n.id]}
                      onClick={() => void checkRelease(n)}
                    >
                      {running[n.id] === "check" ? "Checking…" : "Release"}
                    </button>
                  )}
                  {admin && n.routing_type === "none" && ordering(n) && (
                    <div className="hint" style={{ marginTop: 4, whiteSpace: "normal" }}>
                      Can be released once Telnyx finishes the order.
                    </div>
                  )}
                </td>
              </tr>
              {pending?.id === n.id && pending.kind !== "checking" && (
                <tr>
                  <td colSpan={7}>{confirmation(n, pending)}</td>
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

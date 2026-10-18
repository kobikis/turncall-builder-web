import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { errMsg } from "../errors";
import { ApiResponse, AvailableNumber, AvailableNumbers, BuyCarrier, PurchasedNumber } from "../types";
import PhoneNumberForm, { CARRIER_LABELS } from "./PhoneNumberForm";

// Buy a number on one of the workspace's own carrier accounts, then bind it
// (builder-web #100). Admin-only: the page shows it only to admins and
// builder-api refuses everyone else.

// What the carrier charges, when it says (Telnyx does; Twilio doesn't).
export function costText(n: AvailableNumber): string | null {
  const cur = n.currency ? ` ${n.currency}` : "";
  const given = (v: unknown) => v !== null && v !== undefined && v !== "";
  const parts: string[] = [];
  if (given(n.upfront_cost)) parts.push(`${n.upfront_cost}${cur} upfront`);
  if (given(n.monthly_cost)) parts.push(`${n.monthly_cost}${cur}/month`);
  return parts.length ? parts.join(" + ") : null;
}

const place = (n: AvailableNumber) =>
  [n.locality, n.region, n.country].filter(Boolean).join(", ") || "—";

const abilities = (n: AvailableNumber) => {
  const c = n.capabilities || {};
  return [c.voice && "voice", c.sms && "SMS", c.mms && "MMS"].filter(Boolean).join(", ") || "—";
};

// Where the flow is, so Add Number can keep its Bind/Buy switch from throwing
// away a purchase in flight or a number already bought.
export type BuyStage = "choosing" | "buying" | "bought";

export default function BuyPhoneNumber({ onStage }: { onStage?: (stage: BuyStage) => void }) {
  const [carriers, setCarriers] = useState<BuyCarrier[] | null>(null); // null = loading
  const [carrier, setCarrier] = useState<BuyCarrier>("twilio");
  const [country, setCountry] = useState("US");
  const [areaCode, setAreaCode] = useState("");
  const [contains, setContains] = useState("");
  const [results, setResults] = useState<AvailableNumber[] | null>(null); // null = not searched
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<AvailableNumber | null>(null);
  const [buying, setBuying] = useState(false);
  const [bought, setBought] = useState<PurchasedNumber | null>(null);
  const [err, setErr] = useState("");
  // Bumped by every search and every carrier change: a response that comes
  // back for an older one is dropped, so results never land under the wrong carrier.
  const searchSeq = useRef(0);

  useEffect(() => {
    onStage?.(bought ? "bought" : buying ? "buying" : "choosing");
  }, [bought, buying, onStage]);

  // Which carriers this workspace can buy on: asked without a carrier, so
  // nothing is searched and the server's own rule decides.
  useEffect(() => {
    api<ApiResponse<AvailableNumbers>>("/phone-numbers/available")
      .then((r) => {
        const cs = r.data.carriers || [];
        setCarriers(cs);
        if (cs[0]) setCarrier(cs[0]);
      })
      .catch((e) => {
        setCarriers([]);
        setErr(errMsg(e, "Could not tell which carriers this workspace can buy on."));
      });
  }, []);

  async function search() {
    // While buying, the panel must keep naming the number being bought.
    if (searching || buying) return;
    setErr("");
    setPicked(null);
    const q = new URLSearchParams({ carrier });
    if (country.trim()) q.set("country", country.trim().toUpperCase());
    if (areaCode.trim()) q.set("area_code", areaCode.trim());
    if (contains.trim()) q.set("contains", contains.trim());
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const r = await api<ApiResponse<AvailableNumbers>>(`/phone-numbers/available?${q}`);
      if (seq === searchSeq.current) setResults(r.data.numbers || []);
    } catch (e) {
      if (seq !== searchSeq.current) return;
      setResults(null);
      setErr(errMsg(e, "The search failed."));
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }

  function changeCarrier(c: BuyCarrier) {
    searchSeq.current++; // a search still running was for the old carrier
    setCarrier(c);
    setResults(null);
    setPicked(null);
    setSearching(false);
    setErr("");
  }

  async function buy() {
    if (!picked || buying) return;
    setErr("");
    setBuying(true);
    try {
      const r = await api<ApiResponse<PurchasedNumber>>("/phone-numbers/purchase", {
        method: "POST",
        body: JSON.stringify({ carrier: picked.carrier, e164: picked.e164_number }),
      });
      setBought(r.data);
    } catch (e) {
      // Drop the pick: a "may have been bought" refusal must not be one click
      // away from buying the same number again.
      setPicked(null);
      setErr(errMsg(e, "The purchase failed."));
    } finally {
      setBuying(false);
    }
  }

  if (bought) {
    const label = CARRIER_LABELS[bought.carrier];
    // Bought all the same, but TurnCall couldn't record it in its own log.
    const warning = bought.warning && (
      <div className="callout warn" style={{ maxWidth: 460, marginBottom: 16 }}>{bought.warning}</div>
    );
    if (bought.status === "pending") {
      // Same rule as the Edit page (a fuller fix is #104): the number can be
      // bound once Telnyx finishes the order, and a bind before then is refused.
      return (
        <div style={{ maxWidth: 460 }}>
          <div className="callout info" role="status">
            <strong>{bought.e164} is ordered from {label}</strong>
            <p>
              {label} is still completing the order. The number can be bound once {label} finishes
              it; until then a bind is refused. It's listed on Phone Numbers as unassigned.
            </p>
          </div>
          {warning}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Link to={`/phone-numbers/${bought.id}/edit?bind`} className="btn btn-primary">Bind it on its Edit page</Link>
            <Link to="/phone-numbers" className="btn">Go to Phone Numbers</Link>
          </div>
        </div>
      );
    }
    return (
      <div>
        <div className="callout info" role="status" style={{ maxWidth: 460, marginBottom: 16 }}>
          <strong>Bought {bought.e164} on {label}</strong>
          <p>
            Now choose where its calls go. To do it later, <Link to="/phone-numbers">leave it on
            Phone Numbers</Link>, where it's listed as unassigned.
          </p>
        </div>
        {warning}
        <PhoneNumberForm
          key={bought.id}
          initial={bought}
          lockNumber
          bind
          submitLabel="Bind number"
          onSubmit={(body) => api(`/phone-numbers/${bought.id}`, { method: "PUT", body: JSON.stringify(body) })}
        />
      </div>
    );
  }

  if (carriers === null) return <p className="muted">Loading…</p>;

  if (carriers.length === 0) {
    return (
      <div style={{ maxWidth: 460 }}>
        {err ? (
          <p role="alert" className="error-text">{err}</p>
        ) : (
          <p className="callout">
            Buying a number needs a Twilio or Telnyx account connected to this workspace.
            Connect one on <Link to="/integrations">Integrations</Link>, then come back here.
          </p>
        )}
      </div>
    );
  }

  const showCost = (results || []).some((n) => costText(n) !== null);
  const pickedCost = picked ? costText(picked) : null;

  return (
    <div>
      <div style={{ maxWidth: 460 }}>
        <div className="field">
          <label htmlFor="buy-carrier">Carrier</label>
          <select id="buy-carrier" className="input" value={carrier} disabled={buying}
            onChange={(e) => changeCarrier(e.target.value as BuyCarrier)}>
            {carriers.map((c) => <option key={c} value={c}>{CARRIER_LABELS[c]}</option>)}
          </select>
          <p className="hint" style={{ margin: "4px 0 0" }}>
            Bought on the workspace's own {CARRIER_LABELS[carrier]} account, which the carrier bills.
          </p>
        </div>
        <div className="field">
          <label htmlFor="buy-country">Country</label>
          <input id="buy-country" className="input" value={country} maxLength={2} autoComplete="off"
            spellCheck={false} onChange={(e) => setCountry(e.target.value)} placeholder="US" />
          <p className="hint" style={{ margin: "4px 0 0" }}>Two-letter code, e.g. US, GB, CA.</p>
        </div>
        <div className="field">
          <label htmlFor="buy-area">Area code</label>
          <input id="buy-area" className="input" value={areaCode} inputMode="numeric" autoComplete="off"
            onChange={(e) => setAreaCode(e.target.value)} placeholder="e.g. 312 (optional)" />
        </div>
        <div className="field">
          <label htmlFor="buy-contains">Contains digits</label>
          <input id="buy-contains" className="input" value={contains} inputMode="numeric" autoComplete="off"
            onChange={(e) => setContains(e.target.value)} placeholder="e.g. 5555 (optional)" />
        </div>
        <button className="btn btn-primary" onClick={search} disabled={searching || buying}>
          {searching ? "Searching…" : "Search numbers"}
        </button>
      </div>

      {err && <p role="alert" className="error-text">{err}</p>}

      {results !== null && results.length === 0 && (
        <p className="muted" style={{ marginTop: 16 }}>
          No numbers for sale match. Try another area code or fewer digits.
        </p>
      )}

      {results !== null && results.length > 0 && (
        <div className="table-scroll" style={{ marginTop: 16 }}>
          <table className="list">
            <thead>
              <tr>
                <th>Number</th><th>Location</th><th>Capabilities</th>
                {showCost && <th>Cost</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map((n) => (
                <tr key={n.e164_number}>
                  <td className="num" style={{ fontWeight: 500 }}>
                    {n.e164_number}
                    {n.friendly_name && n.friendly_name !== n.e164_number && (
                      <div className="hint" style={{ fontWeight: 400 }}>{n.friendly_name}</div>
                    )}
                  </td>
                  <td className="hint">{place(n)}</td>
                  <td className="hint">{abilities(n)}</td>
                  {showCost && <td className="hint">{costText(n) ?? "—"}</td>}
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn" style={{ padding: "3px 10px" }}
                      aria-label={`Choose ${n.e164_number}`}
                      aria-pressed={picked?.e164_number === n.e164_number}
                      disabled={buying}
                      onClick={() => { setErr(""); setPicked(n); }}>
                      Choose
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picked && (
        <div className="callout warn" role="group" aria-label={`Buy ${picked.e164_number}`} style={{ maxWidth: 460 }}>
          <strong>Buy {picked.e164_number} on {CARRIER_LABELS[picked.carrier]}?</strong>
          <p>
            {pickedCost ? `It costs ${pickedCost}, billed` : "It's billed"} to the workspace's{" "}
            {CARRIER_LABELS[picked.carrier]} account until the number is released.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setPicked(null)} disabled={buying}>Cancel</button>
            <button className="btn btn-primary" onClick={buy} disabled={buying}>
              {buying ? "Buying…" : `Buy ${picked.e164_number}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

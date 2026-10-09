// Calling a number from an agent, and the agent's do-not-call list (#66).
// The list is TurnCall's suppression list for the agent's project: every
// outbound call checks it, and the do_not_call tool adds to it during calls.
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { fmtTime } from "../../dates";
import type { ApiResponse, PhoneNumber } from "../../types";

type Entry = { id: string; number: string; created_at: string };

/** The agent's numbers that can call out as it: routed to it, and not on
 * Asterisk (TurnCall dials through Twilio and Telnyx only). null = loading. */
export function useDialingNumbers(agentId: string): { numbers: PhoneNumber[] | null; error: string } {
  const [numbers, setNumbers] = useState<PhoneNumber[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<ApiResponse<{ phone_numbers: PhoneNumber[] }>>("/phone-numbers")
      .then((r) => setNumbers(r.data.phone_numbers.filter((n) => n.agent_id === agentId && n.carrier !== "asterisk")))
      .catch((e) => setError(e.message));
  }, [agentId]);
  return { numbers, error };
}
const E164_PLACEHOLDER = "+15551234567";
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export function CallANumber({ agentId, onPlaced }: { agentId: string; onPlaced: () => void }) {
  const { numbers, error: loadError } = useDialingNumbers(agentId);
  const [chosen, setFrom] = useState("");
  const from = chosen || numbers?.[0]?.id || "";
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [callError, setError] = useState("");
  const error = callError || loadError;
  const [placed, setPlaced] = useState("");

  const call = async () => {
    const toNumber = to.trim();
    setBusy(true);
    setError("");
    setPlaced("");
    try {
      await api(`/agents/${agentId}/calls/outbound`, {
        method: "POST",
        body: JSON.stringify({ from_number_id: from, to_number: toNumber }),
      });
      setPlaced(`Calling ${toNumber} — it shows in the list below.`);
      onPlaced();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (numbers === null) return error ? <p role="alert" className="error-text">{error}</p> : null;
  if (numbers.length === 0) {
    return (
      <p className="hint">
        No phone number routed to this agent — bind one on the Phone Numbers page to call out from it.
      </p>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
      <div className="field">
        <label htmlFor="out-from">Call from</label>
        <select id="out-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
          {numbers.map((n) => (
            <option key={n.id} value={n.id}>{n.label ? `${n.e164} — ${n.label}` : n.e164}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="out-to">Number to call</label>
        <input id="out-to" className="input" value={to} placeholder={E164_PLACEHOLDER}
          onChange={(e) => setTo(e.target.value)} />
      </div>
      <button className="btn btn-primary" disabled={busy || !from || !to.trim()} onClick={call}>
        Call
      </button>
      {error && <p role="alert" className="error-text" style={{ flexBasis: "100%" }}>{error}</p>}
      {placed && <p className="hint" style={{ flexBasis: "100%", margin: 0 }}>{placed}</p>}
    </div>
  );
}

export function DoNotCallList({ agentId, editable }: { agentId: string; editable: boolean }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [number, setNumber] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      api<ApiResponse<Entry[]> & { total?: number }>(`/agents/${agentId}/do-not-call`)
        .then((r) => {
          setEntries(r.data);
          setTotal(r.total ?? r.data.length);
        })
        .catch((e) => setError(message(e))),
    [agentId],
  );
  useEffect(() => {
    load();
  }, [load]);

  const change = async (path: string, init: RequestInit): Promise<boolean> => {
    setError("");
    try {
      await api(path, init);
      await load();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    }
  };
  const add = async () => {
    const ok = await change(`/agents/${agentId}/do-not-call`, {
      method: "POST",
      body: JSON.stringify({ number: number.trim() }),
    });
    if (ok) setNumber(""); // a refused number stays, to be corrected
  };

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Numbers this agent never calls. The do_not_call tool adds callers who ask not to be called again.
      </p>
      {editable && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8 }}>
          <div className="field">
            <label htmlFor="dnc-add">Add a number</label>
            <input id="dnc-add" className="input" value={number} placeholder={E164_PLACEHOLDER}
              onChange={(e) => setNumber(e.target.value)} />
          </div>
          <button className="btn" disabled={!number.trim()} onClick={add}>Add</button>
        </div>
      )}
      {error && <p role="alert" className="error-text">{error}</p>}
      {entries?.length === 0 && <p className="muted">No numbers yet.</p>}
      {entries && total > entries.length && (
        <p className="hint">Showing the newest {entries.length} of {total}.</p>
      )}
      {entries && entries.length > 0 && (
        <table className="list">
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="num">{e.number}</td>
                <td className="hint">{fmtTime(e.created_at)}</td>
                {editable && (
                  <td style={{ textAlign: "right" }}>
                    <button className="btn" style={{ padding: "3px 10px" }} aria-label={`Remove ${e.number}`}
                      onClick={() => change(`/agents/${agentId}/do-not-call/${e.id}`, { method: "DELETE" })}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

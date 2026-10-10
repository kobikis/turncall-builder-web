// What an agent's campaigns dial from, and the numbers they never dial (#66).
// The do-not-call list is TurnCall's suppression list for the agent's project:
// every outbound call checks it, and the do_not_call tool adds to it during
// calls. Campaigns are the console's only way to call out.
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
        Numbers this agent's campaigns never call — a target on the list ends suppressed. The do_not_call
        tool adds callers who ask not to be called again.
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

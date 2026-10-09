// An agent's limits (#68): its TurnCall project's (one project per agent).
// Not part of the config, so saved on their own; TurnCall replaces all three at
// once and reads a null one as the platform default.
import { useEffect, useState } from "react";
import { api } from "../../api";
import { NumberField } from "./SettingFields";

type Values = { live_calls: number | null; outbound_calls_per_second: number | null; messages_per_minute: number | null };
const EMPTY: Values = { live_calls: null, outbound_calls_per_second: null, messages_per_minute: null };

export function Limits({ agentId, editable }: { agentId: string; editable: boolean }) {
  const [values, setValues] = useState<Values>(EMPTY);
  // Until the stored limits arrive, Save would send all-null — resetting
  // every limit, since TurnCall's PUT replaces them all.
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<{ data: Values }>(`/agents/${agentId}/limits`)
      .then((r) => {
        setValues({ ...EMPTY, ...r.data });
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [agentId]);

  const set = (key: keyof Values) => (v: number | "") => {
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: v === "" ? null : v }));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const r = await api<{ data: Values }>(`/agents/${agentId}/limits`, {
        method: "PUT",
        body: JSON.stringify(values),
      });
      setValues({ ...EMPTY, ...r.data });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the limits.");
    } finally {
      setSaving(false);
    }
  };

  const disabled = !editable || !loaded;
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>Empty means the platform default (unlimited unless the platform sets one).</p>
      <div style={{ display: "flex", gap: 12 }}>
        <NumberField id="lim-live" label="Concurrent calls" value={values.live_calls} placeholder="default"
          disabled={disabled} onChange={set("live_calls")} />
        <NumberField id="lim-cps" label="Outbound calls per second" value={values.outbound_calls_per_second}
          placeholder="default" disabled={disabled} hint="Per phone number."
          onChange={set("outbound_calls_per_second")} />
        <NumberField id="lim-mpm" label="Messages per minute" value={values.messages_per_minute}
          placeholder="default" disabled={disabled} hint="Per chat, SMS or WhatsApp conversation."
          onChange={set("messages_per_minute")} />
      </div>
      {editable && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button className="btn" disabled={saving || !loaded} onClick={save}>Save limits</button>
          {saved && <span className="hint">Saved — applies to the next call or message.</span>}
        </div>
      )}
      {error && <p role="alert" className="error-text">{error}</p>}
    </>
  );
}

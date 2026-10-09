// A new campaign for the agent (#67): from one of its numbers to a list of
// targets, with an optional calling window and retry rules (turncall#229-#231).
import { useMemo, useState } from "react";
import { api } from "../../api";
import { isTimezone, parseTargets } from "./campaignTargets";
import { useDialingNumbers } from "./Outbound";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
// The endings TurnCall retries (RetryableReason); everything else is final.
const RETRYABLE = [
  { reason: "customer_did_not_answer", label: "Retry no answer" },
  { reason: "customer_busy", label: "Retry busy" },
  { reason: "voicemail", label: "Retry voicemail" },
] as const;
type Retry = { on: boolean; attempts: number; spacingMinutes: number };

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
};

export function CampaignForm({ agentId, onCreated, onClose }: {
  agentId: string;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const { numbers, error: loadError } = useDialingNumbers(agentId);
  const [name, setName] = useState("");
  const [chosen, setFrom] = useState("");
  const from = chosen || numbers?.[0]?.id || "";
  const [timezone, setTimezone] = useState(browserZone());
  const [csv, setCsv] = useState("");
  const [windowOn, setWindowOn] = useState(false);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [days, setDays] = useState<string[]>([...DAYS]);
  const [retries, setRetries] = useState<Record<string, Retry>>(
    Object.fromEntries(RETRYABLE.map((r) => [r.reason, { on: false, attempts: 3, spacingMinutes: 60 }])),
  );
  const [busy, setBusy] = useState(false);
  const [submitError, setError] = useState("");
  const error = submitError || loadError;

  const parsed = useMemo(() => parseTargets(csv, timezone.trim()), [csv, timezone]);
  const setRetry = (reason: string, patch: Partial<Retry>) =>
    setRetries((prev) => ({ ...prev, [reason]: { ...prev[reason], ...patch } }));
  const toggleDay = (day: string) =>
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : DAYS.filter((d) => prev.includes(d) || d === day)));

  // TurnCall's bounds, checked here so the button says why before it is pressed.
  const problems = [
    timezone.trim() && !isTimezone(timezone.trim()) && `${timezone.trim()} is not an IANA timezone.`,
    windowOn && !(start && end && start < end) && "The calling window must start before it ends (no overnight windows).",
    windowOn && days.length === 0 && "Pick at least one day for the calling window.",
    ...RETRYABLE.filter(({ reason }) => retries[reason].on).flatMap(({ reason, label }) => {
      const r = retries[reason];
      return [
        !(r.attempts >= 1 && r.attempts <= 10) && `${label}: 1 to 10 calls in all.`,
        !(r.spacingMinutes >= 1 && r.spacingMinutes <= 7 * 24 * 60) && `${label}: 1 minute to 7 days apart.`,
      ];
    }),
  ].filter(Boolean) as string[];
  const ready = name.trim() && from && parsed.targets.length > 0 && parsed.errors.length === 0 && problems.length === 0;

  const submit = async () => {
    const policy = Object.fromEntries(
      Object.entries(retries)
        .filter(([, r]) => r.on)
        .map(([reason, r]) => [reason, { max_attempts: r.attempts, spacing_seconds: r.spacingMinutes * 60 }]),
    );
    const body = {
      name: name.trim(),
      from_number_id: from,
      ...(timezone.trim() && { timezone: timezone.trim() }),
      ...(windowOn && { calling_window: { start, end, days } }),
      ...(Object.keys(policy).length > 0 && { retry_policy: policy }),
      targets: parsed.targets,
    };
    setBusy(true);
    setError("");
    try {
      const r = await api<{ data: { id: string } }>(`/agents/${agentId}/campaigns`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onCreated(r.data.id);
    } catch (e) {
      // TurnCall counts targets from 0 over what was sent; name the CSV row.
      const message = e instanceof Error ? e.message : "Could not create the campaign.";
      setError(message.replace(/targets\.(\d+)/g, (m, n) => (parsed.rows[Number(n)] ? `row ${parsed.rows[Number(n)]}` : m)));
    } finally {
      setBusy(false);
    }
  };

  const readFile = (file: File | undefined) => file?.text().then(setCsv);

  if (numbers === null) return error ? <p role="alert" className="error-text">{error}</p> : null;
  if (numbers.length === 0) {
    return (
      <div className="card" style={{ padding: 12 }}>
        <p className="hint">No Twilio or Telnyx number routed to this agent — bind one on the Phone Numbers page to run a campaign from it.</p>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 12, maxWidth: 640 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="cmp-name">Name</label>
          <input id="cmp-name" className="input" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="cmp-from">Call from</label>
          <select id="cmp-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
            {numbers.map((n) => <option key={n.id} value={n.id}>{n.e164}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="cmp-tz">Default timezone</label>
        <input id="cmp-tz" className="input" value={timezone} placeholder="America/New_York"
          onChange={(e) => setTimezone(e.target.value)} />
        <p className="hint" style={{ margin: "4px 0 0" }}>
          IANA name, for every target without its own. Never guessed from the number: a mobile keeps its area code wherever its owner lives.
        </p>
      </div>
      <div className="field">
        <label htmlFor="cmp-targets">Targets (CSV)</label>
        <textarea id="cmp-targets" className="input" rows={6} value={csv} spellCheck={false}
          placeholder={"number,timezone,name\n+15551234567,America/Chicago,Jane"}
          onChange={(e) => setCsv(e.target.value)} />
        <input type="file" accept=".csv,text/csv" aria-label="Upload a CSV" onChange={(e) => readFile(e.target.files?.[0])} />
        <p className="hint" style={{ margin: "4px 0 0" }}>
          A <code>number</code> column, an optional <code>timezone</code>; every other column is a variable the agent's prompt reads as <code>{"{{name}}"}</code>.
          {parsed.targets.length > 0 && ` ${parsed.targets.length} target${parsed.targets.length === 1 ? "" : "s"} ready.`}
        </p>
        {parsed.errors.length > 0 && (
          <ul className="error-text" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {parsed.errors.slice(0, 20).map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}
            {parsed.errors.length > 20 && <li>…and {parsed.errors.length - 20} more</li>}
          </ul>
        )}
      </div>

      <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
        <input type="checkbox" checked={windowOn} onChange={(e) => setWindowOn(e.target.checked)} />
        Only call between set hours (each target's local time)
      </label>
      {windowOn && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", margin: "6px 0" }}>
          <div className="field">
            <label htmlFor="cmp-start">From</label>
            <input id="cmp-start" type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cmp-end">Until</label>
            <input id="cmp-end" type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className="radio-row">
            {DAYS.map((d) => (
              <label key={d}>
                <input type="checkbox" checked={days.includes(d)} onChange={() => toggleDay(d)} /> {d}
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={{ margin: "8px 0" }}>
        {RETRYABLE.map(({ reason, label }) => {
          const r = retries[reason];
          return (
            <div key={reason} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontWeight: 400, minWidth: 150 }}>
                <input type="checkbox" checked={r.on} onChange={(e) => setRetry(reason, { on: e.target.checked })} /> {label}
              </label>
              {r.on && (
                <>
                  <input className="input" type="number" min={1} max={10} style={{ width: 70 }} value={r.attempts}
                    aria-label={`${label}: calls in all`} onChange={(e) => setRetry(reason, { attempts: Number(e.target.value) })} />
                  <span className="hint">calls in all, every</span>
                  <input className="input" type="number" min={1} style={{ width: 80 }} value={r.spacingMinutes}
                    aria-label={`${label}: minutes apart`} onChange={(e) => setRetry(reason, { spacingMinutes: Number(e.target.value) })} />
                  <span className="hint">minutes</span>
                </>
              )}
            </div>
          );
        })}
        <p className="hint" style={{ margin: "4px 0 0" }}>Any other ending is final: a call someone answered is never repeated.</p>
      </div>

      {problems.length > 0 && (
        <ul className="error-text" style={{ margin: "0 0 8px", paddingLeft: 18 }}>
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" disabled={busy || !ready} onClick={submit}>Start campaign</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
    </div>
  );
}

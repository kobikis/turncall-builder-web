import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { AgentRef as Agent } from "../types";

type Routing = "agent" | "agent_call_init" | "webhook" | "none";
export type PhoneInitial = {
  e164?: string;
  sid?: string;
  routing_type?: Routing;
  agent_id?: string | null;
  server_url?: string | null;
  server_url_secret?: string | null;
  sms_enabled?: boolean;
};

const E164_RE = /^\+[1-9]\d{1,14}$/;
const SID_RE = /^PN[a-zA-Z0-9]{8,}$/;

// Whether an edit moves the number to a different TurnCall project — that
// rebinding rotates the phone id AND the call-init signing secret.
function crossesProjects(before: PhoneInitial, after: { routing: Routing; agentId: string }): boolean {
  if (!before.routing_type || before.routing_type === "none") return false;
  const agentOwned = (r: Routing) => r === "agent" || r === "agent_call_init";
  if (agentOwned(before.routing_type) && agentOwned(after.routing)) {
    return before.agent_id !== after.agentId; // different agent = different project
  }
  return before.routing_type !== after.routing;
}

// Shared Add/Edit form. onSubmit returns the api() data payload.
export default function PhoneNumberForm(props: {
  initial?: PhoneInitial;
  lockNumber?: boolean;
  submitLabel: string;
  onSubmit: (body: any) => Promise<any>;
}) {
  const nav = useNavigate();
  const i = props.initial || {};
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sid, setSid] = useState(i.sid || "");
  const [e164, setE164] = useState(i.e164 || "");
  const [routing, setRouting] = useState<Routing>(i.routing_type || "agent");
  const [agentId, setAgentId] = useState(i.agent_id || "");
  const [serverUrl, setServerUrl] = useState(i.server_url || "");
  const [sms, setSms] = useState(!!i.sms_enabled);
  const [voiceHook, setVoiceHook] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [postSubmit, setPostSubmit] = useState<{ secret?: string; twilioWarn?: boolean } | null>(null);

  useEffect(() => {
    api("/agents")
      .then((r) => {
        setAgents(r.data.agents);
        if (!agentId && r.data.agents[0]) setAgentId(r.data.agents[0].agent_id);
      })
      .catch((e) => setErr(e.message));
    api("/meta").then((r) => setVoiceHook(r.data.twilio_voice_webhook)).catch(() => {});
  }, []);

  function validate(): string {
    if (!SID_RE.test(sid)) return "Twilio SID should look like PNxxxxxxxx.";
    if (!E164_RE.test(e164)) return "Number must be E.164, e.g. +15551234567.";
    if ((routing === "agent" || routing === "agent_call_init") && !agentId)
      return "Pick an agent (or create one first).";
    if (routing === "webhook" && !/^https?:\/\//.test(serverUrl))
      return "Call-init server URL must be an http(s) URL.";
    return "";
  }

  async function submit() {
    if (busy) return;
    setErr("");
    const invalid = validate();
    if (invalid) {
      setErr(invalid);
      return;
    }
    if (
      crossesProjects(i, { routing, agentId }) &&
      !confirm(
        "This edit moves the number to a different project: its phone id and call-init signing secret will ROTATE, and any endpoint verifying the old secret must be updated. Continue?"
      )
    )
      return;
    const body: any = { sid, e164, routing_type: routing, sms_enabled: sms };
    if (routing === "agent" || routing === "agent_call_init") body.agent_id = agentId;
    if (routing === "webhook") body.server_url = serverUrl;
    setBusy(true);
    try {
      const r = await props.onSubmit(body);
      const secret = r?.data?.server_url_secret;
      const showSecret =
        routing === "webhook" && secret && secret !== i.server_url_secret;
      const twilioWarn = r?.data?.twilio_webhooks_configured === false;
      if (showSecret || twilioWarn) {
        setPostSubmit({ secret: showSecret ? secret : undefined, twilioWarn });
      } else {
        nav("/phone-numbers");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  if (postSubmit) {
    return (
      <div style={{ maxWidth: 460 }}>
        {postSubmit.twilioWarn && (
          <div className="callout error">
            <strong>Twilio was NOT configured — this number won't receive calls yet</strong>
            <p>
              TurnCall couldn't set the number's webhooks (usually <code>PUBLIC_BASE_URL</code>{" "}
              or Twilio credentials missing on the TurnCall server, or a Twilio error).
              The binding itself is saved. After fixing the environment, just re-save
              this number — updates re-run the Twilio configuration. Or set the Voice
              webhook manually in the Twilio console (A Call Comes In → Webhook, POST):
            </p>
            <code className="block">{voiceHook || "…"}</code>
          </div>
        )}
        {postSubmit.secret && (
          <div className="callout warn">
            <strong>Call-init signing secret</strong>
            <p>
              Paste this into your endpoint to verify <code>X-TurnCall-Signature</code>.
              It stays visible on this number's edit page.
            </p>
            <code className="block">{postSubmit.secret}</code>
          </div>
        )}
        <button className="btn btn-primary" onClick={() => nav("/phone-numbers")}>Done</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 460 }}>
      <div className="field">
        <label htmlFor="pn-sid">Twilio Phone Number SID</label>
        <input id="pn-sid" name="twilio_sid" className="input" value={sid} disabled={props.lockNumber}
          autoComplete="off" spellCheck={false}
          onChange={(e) => setSid(e.target.value)} placeholder="PNxxxxxxxx" />
      </div>

      <div className="field">
        <label htmlFor="pn-e164">Number (E.164)</label>
        <input id="pn-e164" name="phone_number" type="tel" inputMode="tel" className="input" value={e164}
          disabled={props.lockNumber} autoComplete="off"
          onChange={(e) => setE164(e.target.value)} placeholder="+15551234567" />
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ padding: 0, fontWeight: 500, fontSize: 13 }}>Routing</legend>
        <div className="radio-row">
          <label>
            <input type="radio" name="routing" checked={routing === "agent"} onChange={() => setRouting("agent")} /> Agent
          </label>
          <label>
            <input type="radio" name="routing" checked={routing === "agent_call_init"} onChange={() => setRouting("agent_call_init")} /> Agent + caller info
          </label>
          <label>
            <input type="radio" name="routing" checked={routing === "webhook"} onChange={() => setRouting("webhook")} /> Custom call-init webhook
          </label>
          <label>
            <input type="radio" name="routing" checked={routing === "none"} onChange={() => setRouting("none")} /> Unassigned
          </label>
        </div>
      </fieldset>

      {(routing === "agent" || routing === "agent_call_init") && (
        <div className="field">
          <label htmlFor="pn-agent">Agent</label>
          {agents.length === 0 ? (
            <p className="muted">
              No agents yet — <Link to="/agents/new">create one</Link> first.
            </p>
          ) : (
            <select id="pn-agent" className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => <option key={a.agent_id} value={a.agent_id}>{a.name}</option>)}
            </select>
          )}
        </div>
      )}
      {routing === "agent_call_init" && (
        <p className="callout info">
          On each inbound call, the agent's generated backend looks up the caller and
          loads their info into the conversation before it starts. The lookup is a stub —
          edit <code>/call-init</code> in the generated repo to query your CRM.
        </p>
      )}
      {routing === "webhook" && (
        <>
          <div className="field">
            <label htmlFor="pn-url">Call-init server URL</label>
            <input id="pn-url" name="server_url" type="url" className="input" value={serverUrl}
              autoComplete="off" spellCheck={false}
              onChange={(e) => setServerUrl(e.target.value)} placeholder="https://host/call-init" />
            <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
              You host this endpoint: it picks the agent per call and supplies variables.
              See <code>docs/call-init.md</code> in turncall-builder-api.
            </p>
          </div>
          {i.server_url_secret && (
            <div className="callout warn">
              <strong>Call-init signing secret</strong>
              <p>Paste into this number's endpoint to verify <code>X-TurnCall-Signature</code>:</p>
              <code className="block">{i.server_url_secret}</code>
            </div>
          )}
        </>
      )}
      {routing === "none" && (
        <p className="callout">
          Tracked but not routed — no agent, no webhook. Assign one later to activate it.
        </p>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400, margin: "0 0 16px" }}>
        <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} /> Enable SMS
      </label>

      <button className="btn btn-primary" onClick={submit} disabled={busy}>
        {busy ? "Saving…" : props.submitLabel}
      </button>
      {err && <p role="alert" className="error-text">{err}</p>}

      {routing !== "none" && (
        <div className="callout" style={{ marginTop: 20 }}>
          <strong>Twilio voice webhook</strong>
          <p>
            TurnCall sets this automatically on bind (needs <code>PUBLIC_BASE_URL</code>).
            To verify or set it manually in the Twilio console (A Call Comes In → Webhook, POST):
          </p>
          <code className="block">{voiceHook || "…"}</code>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { AgentRef as Agent } from "../types";

type Routing = "agent" | "agent_call_init" | "webhook" | "none";
// Who the number belongs to (TurnCall ADR-0022). Fixed once bound.
export type Carrier = "twilio" | "telnyx" | "asterisk";
export const CARRIER_LABELS: Record<Carrier, string> = { twilio: "Twilio", telnyx: "Telnyx", asterisk: "Asterisk (your PBX)" };
export type PhoneInitial = {
  carrier?: Carrier;
  e164?: string;
  label?: string | null;
  sid?: string;
  routing_type?: Routing;
  agent_id?: string | null;
  server_url?: string | null;
  server_url_secret?: string | null;
  sms_enabled?: boolean;
  // The number's own Twilio account, if any. The token is never sent back.
  twilio_account_sid?: string | null;
  twilio_credentials?: "workspace" | "number" | "platform";
};

const E164_RE = /^\+[1-9]\d{1,14}$/;
const SID_RE = /^PN[a-zA-Z0-9]{8,}$/;
const ACCOUNT_RE = /^AC[0-9a-fA-F]{32}$/;

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
  // Opened to bind the number (a bought one, or Edit's ?bind): an unassigned
  // number then starts on Agent routing instead of Unassigned.
  bind?: boolean;
  // A bought Telnyx number whose order hasn't finished (#104). Nothing can ask
  // Telnyx whether it has, so a bind is the check: the submit says it's an
  // attempt while a routing is chosen, and a refusal leaves every value as it was.
  pendingBind?: boolean;
  submitLabel: string;
  onSubmit: (body: any) => Promise<any>;
}) {
  const nav = useNavigate();
  const i = props.initial || {};
  const [agents, setAgents] = useState<Agent[]>([]);
  const [carrier, setCarrier] = useState<Carrier>(i.carrier || "twilio");
  // Twilio's own features — its account, number SID, SMS — apply to Twilio only.
  const isTwilio = carrier === "twilio";
  const [sid, setSid] = useState(i.sid || "");
  const [e164, setE164] = useState(i.e164 || "");
  const [routing, setRouting] = useState<Routing>(
    !i.routing_type || (props.bind && i.routing_type === "none") ? "agent" : i.routing_type,
  );
  // No agent is preselected: the user picks one, so a submit can't route the
  // number to an agent nobody chose (#106, #107). A bound number keeps its
  // agent, and a workspace with exactly one agent gets it, as there's no choice.
  const [agentId, setAgentId] = useState(i.agent_id || "");
  const [serverUrl, setServerUrl] = useState(i.server_url || "");
  const [sms, setSms] = useState(!!i.sms_enabled);
  const [label, setLabel] = useState(i.label || "");
  const savedAccount = i.twilio_credentials === "number" ? i.twilio_account_sid || "" : "";
  const [accountSid, setAccountSid] = useState(savedAccount);
  const [authToken, setAuthToken] = useState(""); // write-only: never prefilled
  // The Workspace's connected Twilio account, if any (Integrations page).
  const [workspaceTwilio, setWorkspaceTwilio] = useState<{ account_sid: string } | null>(null);
  const [useWorkspaceChoice, setUseWorkspaceChoice] = useState(i.twilio_credentials === "workspace");
  const useWorkspace = isTwilio && useWorkspaceChoice;
  const [accountNumbers, setAccountNumbers] = useState<{ sid: string; phone_number: string; friendly_name?: string | null; bound: boolean }[]>([]);
  // Own account = the number runs on these credentials; else the platform's.
  const ownAccount = isTwilio && !useWorkspace && accountSid.trim() !== "";
  const [voiceHook, setVoiceHook] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [postSubmit, setPostSubmit] = useState<{ secret?: string; twilioWarn?: boolean; telnyxWarn?: boolean } | null>(null);

  useEffect(() => {
    api("/agents")
      .then((r) => {
        setAgents(r.data.agents);
        if (!i.agent_id && r.data.agents.length === 1) setAgentId(r.data.agents[0].agent_id);
      })
      .catch((e) => setErr(e.message));
    api("/meta").then((r) => setVoiceHook(r.data.twilio_voice_webhook)).catch(() => {});
    api("/integrations/twilio")
      .then((r) => {
        if (!r.data?.connected) return;
        setWorkspaceTwilio({ account_sid: r.data.account_sid });
        // A new number defaults to the workspace's account once there is one.
        if (!i.twilio_credentials) setUseWorkspaceChoice(true);
      })
      .catch(() => {});
  }, []);

  // The connected account's numbers, to pick instead of typing (new numbers only).
  useEffect(() => {
    if (!useWorkspace || !workspaceTwilio || props.lockNumber) return;
    api("/integrations/twilio/numbers")
      .then((r) => setAccountNumbers(Array.isArray(r.data) ? r.data : []))
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not list the account's numbers."));
  }, [useWorkspace, workspaceTwilio, props.lockNumber]);

  function validate(): string {
    if (!E164_RE.test(e164)) return "Number must be E.164, e.g. +15551234567.";
    // Telnyx is looked up by its number on the account; Asterisk has no SID.
    if (!isTwilio) return routingError();
    if (useWorkspace) {
      if (!workspaceTwilio) return "This workspace has no Twilio account connected.";
    } else if (ownAccount) {
      if (!ACCOUNT_RE.test(accountSid.trim())) return "Twilio Account SID should look like AC followed by 32 hex characters.";
      // A saved account can be kept without re-entering its token; a new or
      // changed one needs it.
      if (!authToken.trim() && accountSid.trim() !== savedAccount) return "Enter the Twilio Auth Token for this account.";
    } else if (!SID_RE.test(sid)) {
      return "Twilio Phone Number SID should look like PNxxxxxxxx — or enter your Twilio Account SID and Auth Token instead.";
    }
    return routingError();
  }

  function routingError(): string {
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
    const body: any = {
      carrier,
      sid: ownAccount || !isTwilio ? "" : sid,
      e164,
      routing_type: routing,
      sms_enabled: isTwilio && sms,
    };
    if (useWorkspace) body.use_workspace_twilio = true;
    body.label = label.trim() || null;
    if (ownAccount && authToken.trim()) {
      body.twilio_account_sid = accountSid.trim();
      body.twilio_auth_token = authToken.trim();
    }
    if (routing === "agent" || routing === "agent_call_init") body.agent_id = agentId;
    if (routing === "webhook") body.server_url = serverUrl;
    setBusy(true);
    try {
      const r = await props.onSubmit(body);
      const secret = r?.data?.server_url_secret;
      const showSecret =
        routing === "webhook" && secret && secret !== i.server_url_secret;
      const twilioWarn = isTwilio && r?.data?.twilio_webhooks_configured === false;
      const telnyxWarn = carrier === "telnyx" && r?.data?.webhooks_configured === false;
      if (showSecret || twilioWarn || telnyxWarn) {
        setPostSubmit({ secret: showSecret ? secret : undefined, twilioWarn, telnyxWarn });
      } else {
        nav("/phone-numbers");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  // Agent routing with no agent picked yet: nothing to submit.
  const agentUnpicked = (routing === "agent" || routing === "agent_call_init") && !agentId;

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
        {postSubmit.telnyxWarn && (
          <div className="callout error">
            <strong>Telnyx was NOT configured — this number won't receive calls yet</strong>
            <p>
              TurnCall couldn't put the number on its Call Control application (usually{" "}
              <code>PUBLIC_BASE_URL</code> missing on the TurnCall server, or a Telnyx error).
              The binding itself is saved; re-save this number once that is fixed.
            </p>
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
        <label htmlFor="pn-carrier">Carrier</label>
        <select id="pn-carrier" className="input" value={carrier} disabled={props.lockNumber}
          onChange={(e) => setCarrier(e.target.value as Carrier)}>
          {(Object.keys(CARRIER_LABELS) as Carrier[]).map((c) => (
            <option key={c} value={c}>{CARRIER_LABELS[c]}</option>
          ))}
        </select>
        {carrier === "telnyx" && (
          <p className="hint" style={{ margin: "4px 0 0" }}>
            Looked up by its number on the workspace's Telnyx account (Integrations), else the platform's.
          </p>
        )}
        {carrier === "asterisk" && (
          <p className="hint" style={{ margin: "4px 0 0" }}>
            Your PBX routes it: send the number's calls to <code>Stasis(turncall)</code> in its dialplan.
          </p>
        )}
      </div>

      {isTwilio && workspaceTwilio && (
        <fieldset style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
          <legend style={{ padding: 0, fontWeight: 500, fontSize: 13 }}>Twilio account</legend>
          <div className="radio-row">
            <label>
              <input type="radio" name="twilio-source" checked={useWorkspace} onChange={() => setUseWorkspaceChoice(true)} />{" "}
              Workspace account ({workspaceTwilio.account_sid.slice(0, 8)}…)
            </label>
            <label>
              <input type="radio" name="twilio-source" checked={!useWorkspace} onChange={() => setUseWorkspaceChoice(false)} />{" "}
              Other credentials
            </label>
          </div>
        </fieldset>
      )}

      {useWorkspace && workspaceTwilio && !props.lockNumber && (
        <div className="field">
          <label htmlFor="pn-pick">Number on this account</label>
          <select
            id="pn-pick"
            className="input"
            value={sid}
            onChange={(e) => {
              const picked = accountNumbers.find((n) => n.sid === e.target.value);
              setSid(picked?.sid || "");
              setE164(picked?.phone_number || "");
            }}
          >
            <option value="">— select —</option>
            {accountNumbers.map((n) => (
              <option key={n.sid} value={n.sid} disabled={n.bound}>
                {n.phone_number}
                {n.friendly_name && n.friendly_name !== n.phone_number ? ` — ${n.friendly_name}` : ""}
                {n.bound ? " (already added)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {!(useWorkspace && workspaceTwilio && !props.lockNumber) && (
      <div className="field">
        <label htmlFor="pn-e164">{isTwilio ? "Twilio Phone Number" : "Phone number"}</label>
        <input id="pn-e164" name="phone_number" type="tel" inputMode="tel" className="input" value={e164}
          disabled={props.lockNumber} autoComplete="off"
          onChange={(e) => setE164(e.target.value)} placeholder="+15551234567" />
      </div>
      )}

      {isTwilio && !useWorkspace && !ownAccount && (
        <div className="field">
          <label htmlFor="pn-sid">Twilio Phone Number SID</label>
          <input id="pn-sid" name="twilio_sid" className="input" value={sid} disabled={props.lockNumber}
            autoComplete="off" spellCheck={false}
            onChange={(e) => setSid(e.target.value)} placeholder="PNxxxxxxxx" />
          <p className="hint" style={{ margin: "4px 0 0" }}>
            Needed only on the platform's account — enter your own Account SID below and it is looked up for you.
          </p>
        </div>
      )}

      <div className="field">
        <label htmlFor="pn-label">Label</label>
        <input id="pn-label" name="label" className="input" value={label} maxLength={100}
          autoComplete="off" onChange={(e) => setLabel(e.target.value)}
          placeholder="Label for phone number, e.g. Support line" />
      </div>

      {isTwilio && !useWorkspace && (
      <>
      <div className="field">
        <label htmlFor="pn-account">Twilio Account SID</label>
        <input id="pn-account" name="twilio_account_sid" className="input" value={accountSid}
          autoComplete="off" spellCheck={false}
          onChange={(e) => setAccountSid(e.target.value)} placeholder="ACxxxxxxxx" />
      </div>

      <div className="field">
        <label htmlFor="pn-token">Twilio Auth Token</label>
        <input id="pn-token" name="twilio_auth_token" type="password" className="input" value={authToken}
          autoComplete="new-password" spellCheck={false}
          onChange={(e) => setAuthToken(e.target.value)}
          placeholder={savedAccount ? "Saved — leave blank to keep it" : "Twilio Auth Token"} />
        <p className="hint" style={{ margin: "4px 0 0" }}>
          From your Twilio console. Checked against the number when you save, stored
          encrypted, and never shown again. Leave both blank to use the platform's
          Twilio account.
        </p>
      </div>
      </>
      )}

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
              {!agentId && <option value="" disabled>Choose an agent…</option>}
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
            <p className="hint" style={{ margin: "4px 0 0" }}>
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

      {isTwilio ? (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400, margin: "0 0 16px" }}>
          <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} /> Enable SMS
        </label>
      ) : (
        <div style={{ height: 8 }} />
      )}

      {agentUnpicked && agents.length > 0 && (
        <p id="pn-agent-hint" className="hint" style={{ margin: "0 0 8px" }}>Choose an agent to bind the number to.</p>
      )}
      <button className="btn btn-primary" onClick={submit} disabled={busy || agentUnpicked}
        aria-describedby={agentUnpicked && agents.length > 0 ? "pn-agent-hint" : undefined}>
        {props.pendingBind && routing !== "none"
          ? busy ? "Trying…" : "Try binding now"
          : busy ? "Saving…" : props.submitLabel}
      </button>
      {err && <p role="alert" className="error-text">{err}</p>}

      {isTwilio && routing !== "none" && (
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

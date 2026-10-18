import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { TwilioCard } from "./TwilioAccount";
import { tint } from "../../apps";

// A Workspace's own provider accounts (ADR-0023, #44-#46).
//
// One card per provider *account*: Deepgram appears once and serves both
// transcription and voice. Entry is write-only — a saved key is never rendered
// back, only its presence and last four characters — and the card says which
// key a call will actually use, which is the point of the page.

export type Role = "llm" | "stt" | "tts" | "s2s" | "avatar" | "judge" | "carrier";

export type AgentProjection = {
  agent_id: string;
  name?: string | null;
  state: string;
  error?: string | null;
};

export type ProviderCard = {
  provider: string;
  serves: Partial<Record<Role, string[]>>;
  connected: boolean;
  last4: string | null;
  validation: { status?: string; checked?: string | null; detail?: string } | null;
  disconnecting: boolean;
  platform_key: boolean | null;
  runs_on: "workspace" | "platform" | "none" | "unknown";
  agents_using: number;
  pinned_agents: { agent_id: string; name?: string | null }[];
  agents: AgentProjection[];
  // Numbers on a custom call-init server (builder-api#65): their project's
  // projection, and how many still sit in the old shared project.
  webhook_numbers?: { state: string | null; error: string | null; on_platform_keys: number };
};

export const ROLE_LABELS: Record<Role, string> = {
  llm: "Model",
  stt: "STT",
  tts: "TTS",
  s2s: "Speech-to-speech",
  avatar: "Avatar",
  judge: "Eval judge",
  carrier: "Carrier",
};
const ROLE_ORDER: Role[] = ["llm", "stt", "tts", "s2s", "avatar", "judge", "carrier"];
// Which group a multi-role card is browsed under. TTS before STT:
// every TTS provider also transcribes, so the other way round empties TTS.
const GROUP_ORDER: Role[] = ["llm", "tts", "s2s", "stt", "avatar", "judge", "carrier"];

type Field = { name: string; label: string; secret: boolean; required?: boolean };
const AWS_FIELDS: Field[] = [
  { name: "access_key_id", label: "Access key ID", secret: false },
  { name: "secret_access_key", label: "Secret access key", secret: true },
  { name: "session_token", label: "Session token (optional)", secret: true },
  { name: "role_arn", label: "Role ARN (instead of keys)", secret: false },
  { name: "external_id", label: "External ID (with a role ARN)", secret: false },
  { name: "profile", label: "Profile on the TurnCall host (instead of keys)", secret: false },
  { name: "region", label: "Region (optional)", secret: false },
];

// Accounts whose credential is more than one API key (builder-api#84). The
// rest take `{api_key}`. Blank fields are left out: TurnCall's default.
const ACCOUNT_FIELDS: Record<string, Field[]> = {
  aws: AWS_FIELDS,
  telnyx: [
    { name: "api_key", label: "API key", secret: true, required: true },
    // Not a secret, but required: it verifies the account's webhooks.
    { name: "public_key", label: "Public key", secret: false, required: true },
  ],
  // The PBX's ARI login; one PBX serves every agent (kobikis/turncall#274).
  asterisk: [
    { name: "ari_url", label: "ARI URL", secret: false, required: true },
    { name: "username", label: "Username", secret: false, required: true },
    { name: "password", label: "Password", secret: true, required: true },
    { name: "app", label: "Stasis app (optional)", secret: false },
    { name: "media_connection", label: "Media connection (optional)", secret: false },
    { name: "transfer_context", label: "Transfer context (optional)", secret: false },
  ],
};

/** The sentence a card leads with: which key a call on this provider runs on. */
export function runsOnText(card: ProviderCard): string {
  switch (card.runs_on) {
    case "workspace":
      return `Calls use this workspace's key${card.last4 ? ` ····${card.last4}` : ""}.`;
    case "platform":
      return "Calls use the platform's key.";
    case "none":
      // A carrier is used through numbers, not agents: nothing fails until one is bound.
      return card.serves.carrier?.length
        ? "No account — numbers on this carrier can't be bound or answered until one is connected."
        : "No key — neither this workspace nor the platform has one, so calls on it will fail.";
    default:
      return "Whether the platform has a key could not be checked.";
  }
}

/** The exception to `runsOnText`: custom call-init numbers that are not on
 * this workspace's key. Null when there is nothing to say. */
export function webhookNumbersText(card: ProviderCard): string | null {
  const w = card.webhook_numbers;
  if (!w || !card.connected) return null;
  if (w.state === "failed")
    return `Custom call-init numbers did not get this key${w.error ? ` (${w.error})` : ""}.`;
  const n = w.on_platform_keys;
  if (n > 0)
    return `${n === 1 ? "1 custom call-init number still runs" : `${n} custom call-init numbers still run`} on the platform's key — rebind ${n === 1 ? "it" : "them"} to use this one.`;
  return null;
}

/** What disconnecting will actually do, in words (#45). */
export function disconnectText(card: ProviderCard): string {
  if (card.serves.carrier?.length) {
    const name = displayName(card.provider);
    return card.platform_key
      ? `${name} numbers then use the platform's account.`
      : `The platform has no ${name} account, so ${name} numbers stop working after disconnecting.`;
  }
  const n = card.agents_using;
  const who = n === 1 ? "1 agent uses" : `${n} agents use`;
  if (card.platform_key === null)
    return `${who} this key. Whether the platform has a ${card.provider} key could not be checked, so their calls may fail after disconnecting.`;
  return card.platform_key
    ? `${who} this key. After disconnecting they fall back to the platform's key.`
    : `${who} this key. The platform has no ${card.provider} key, so after disconnecting their calls will fail.`;
}

function validationText(v: ProviderCard["validation"]): string | null {
  if (!v?.status) return null;
  if (v.status === "valid") return `Accepted by ${v.checked} — checked against a list endpoint, not a live call.`;
  if (v.status === "unchecked") return "Not checked: this provider has no list endpoint to ask.";
  return `Could not be checked (${v.detail}). Saved anyway.`;
}

const DISPLAY_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  aws: "AWS",
  google: "Google Gemini",
  deepgram: "Deepgram",
  elevenlabs: "ElevenLabs",
  cartesia: "Cartesia",
  telnyx: "Telnyx",
  asterisk: "Asterisk (your PBX)",
  assemblyai: "AssemblyAI",
  heygen: "HeyGen",
  tavus: "Tavus",
  typesafe: "TypeSafe (Jev)",
};
export const displayName = (provider: string) =>
  DISPLAY_NAMES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);

// A request the server may refuse until bound numbers are acknowledged
// (builder-api#114); `acknowledge` is set only on the resend.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Send = (acknowledge?: string[]) => Promise<any>;

/** The refusal to connect a Telnyx account that doesn't hold this workspace's
 * bound numbers: they'd stop answering calls (builder-api#114). */
const strandedNumbers = (e: unknown): string[] | null =>
  e instanceof ApiError && e.reason === "numbers_not_on_account" && e.numbers?.length ? e.numbers : null;

/** The same body, carrying the acknowledgement only on a resend. */
const withAck = (body: Record<string, unknown>, acknowledge?: string[]) =>
  acknowledge ? { ...body, acknowledge_numbers: acknowledge } : body;

const primaryRole = (card: ProviderCard): Role =>
  GROUP_ORDER.find((r) => card.serves[r]?.length) ?? "llm";

function Card({
  card,
  isAdmin,
  onData,
}: {
  card: ProviderCard;
  isAdmin: boolean;
  onData: (cards: ProviderCard[] | null) => void;
}) {
  const fields = ACCOUNT_FIELDS[card.provider];
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  // Numbers the server says this account would strand, and how to resend the
  // refused request with them acknowledged.
  const [stranded, setStranded] = useState<{ numbers: string[]; resend: () => void } | null>(null);
  const [understood, setUnderstood] = useState(false);
  const discardStranded = () => {
    setStranded(null);
    setUnderstood(false);
  };
  const close = () => {
    setOpen(false);
    setConfirming(false);
    setValues({});
    setError("");
    discardStranded();
  };

  const run = async (
    send: Send,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    done: (r: any) => void = () => onData(null), // reload
    fallback = "Something went wrong.",
    acknowledge?: string[],
  ) => {
    setBusy(true);
    setError("");
    try {
      const r = await send(acknowledge);
      close();
      done(r);
    } catch (e) {
      const numbers = strandedNumbers(e);
      setUnderstood(false);
      if (numbers) {
        setStranded({ numbers, resend: () => void run(send, done, fallback, numbers) });
      } else {
        setStranded(null);
        setError(e instanceof Error ? e.message : fallback);
      }
    } finally {
      setBusy(false);
    }
  };

  const body = fields
    ? Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()))
    : { api_key: values.api_key || "" };
  // An AWS set has to name a source; a region alone changes nothing.
  const canSave =
    card.provider === "aws"
      ? Boolean(body.access_key_id || body.role_arn || body.profile)
      : fields
        ? fields.every((f) => !f.required || values[f.name]?.trim())
        : Boolean(values.api_key?.trim());

  const save = () =>
    run((ack) =>
      api(`/integrations/providers/${card.provider}`, {
        method: "PUT",
        body: JSON.stringify(withAck(body, ack)),
      }),
    );
  const disconnect = () =>
    run(() => api(`/integrations/providers/${card.provider}`, { method: "DELETE" }));
  const retry = () =>
    run((ack) =>
      api(`/integrations/providers/${card.provider}/apply`, {
        method: "POST",
        ...(ack ? { body: JSON.stringify(withAck({}, ack)) } : {}),
      }),
    );
  const adopt = (agentId: string) =>
    run(
      (ack) =>
        api(`/integrations/providers/${card.provider}/adopt`, {
          method: "POST",
          body: JSON.stringify(withAck({ agent_id: agentId }, ack)),
        }),
      (r) => onData(r.data.providers),
      "Could not adopt the key.",
    );

  const failed = card.agents.filter((a) => a.state === "failed" || a.state === "remove_failed");
  const pinned = card.pinned_agents.length;
  const roles = ROLE_ORDER.filter((r) => card.serves[r]?.length);
  const checked = validationText(card.validation);

  const name = displayName(card.provider);
  const one = stranded?.numbers.length === 1;
  const strandedPanel = stranded && (
    <div className="callout warn" role="alertdialog" aria-label={`Numbers not on this ${name} account`}>
      <strong>{one ? `This number isn't` : `These numbers aren't`} on this {name} account:</strong>
      <ul>
        {stranded.numbers.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p>
        {one ? "It's" : "They're"} bound in this workspace but on another {name} account, likely
        TurnCall's platform account. Once this account is connected, {one ? "it" : "they"} will stop
        answering calls.
      </p>
      <label
        htmlFor={`${card.provider}-ack-numbers`}
        style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400, marginTop: 8 }}
      >
        <input
          id={`${card.provider}-ack-numbers`}
          type="checkbox"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
        />
        I understand these numbers will stop answering calls
      </label>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={discardStranded}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy || !understood}
          onClick={stranded.resend}
        >
          Connect anyway
        </button>
      </div>
    </div>
  );
  const status = card.disconnecting
    ? { cls: "warn", text: "Disconnecting" }
    : card.connected
      ? { cls: "connected", text: "Connected" }
      : card.runs_on === "platform"
        ? { cls: "platform", text: "Platform key" }
        : card.runs_on === "none"
          ? { cls: "missing", text: "No key" }
          : { cls: "disconnected", text: "Not connected" };

  return (
    <div className="integration-card provider-card" data-testid={`provider-${card.provider}`}>
      <div className="head">
        <span className="app-tile" aria-hidden="true" style={{ background: tint(card.provider) }}>
          {name.charAt(0)}
        </span>
        <div className="title">
          <div className="name">{name}</div>
          <div className="roles">{roles.map((r) => ROLE_LABELS[r]).join(" · ")}</div>
        </div>
      </div>
      <p className={`desc${card.runs_on === "none" ? " danger" : ""}`}>{runsOnText(card)}</p>
      {webhookNumbersText(card) &&
        (card.webhook_numbers?.state === "failed" ? (
          <div className="callout warn">
            {webhookNumbersText(card)}
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 8 }}
              disabled={busy}
              onClick={() => void retry()}
            >
              Retry
            </button>
          </div>
        ) : (
          <p className="desc meta">{webhookNumbersText(card)}</p>
        ))}
      {!open && strandedPanel}
      {pinned > 0 && (
        <p className="desc meta">
          {pinned === 1 ? "1 agent uses its own key" : `${pinned} agents use their own key`} for
          its model instead of this one.
        </p>
      )}
      {failed.length > 0 && (
        <p className="desc meta danger">
          {card.disconnecting ? "Still holding the key: " : "Not yet applied to: "}
          {failed.map((a) => a.name || a.agent_id).join(", ")}
        </p>
      )}
      <div className="foot">
        <span className={`badge app-status ${status.cls}`}>{status.text}</span>
        {isAdmin && (
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            {card.connected || card.disconnecting ? "Manage" : "Connect"}
          </button>
        )}
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => !busy && close()}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${name} key`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <span className="app-tile" aria-hidden="true" style={{ background: tint(card.provider) }}>
                {name.charAt(0)}
              </span>
              <div className="title">
                <div className="name">{name}</div>
                <div className="roles">{roles.map((r) => ROLE_LABELS[r]).join(" · ")}</div>
              </div>
              <button type="button" className="modal-close" aria-label="Close" onClick={close}>
                ×
              </button>
            </div>

            <p className="modal-status">{runsOnText(card)}</p>
            {card.connected && checked && <p className="hint">{checked}</p>}

            {/* Adoption only fills an empty slot — it never replaces a workspace key. */}
            {!card.connected &&
              card.pinned_agents.map((a) => (
                <div key={a.agent_id} className="modal-row">
                  <span>{a.name || a.agent_id} uses its own key</span>
                  <button type="button" className="btn" disabled={busy} onClick={() => void adopt(a.agent_id)}>
                    Adopt into workspace
                  </button>
                </div>
              ))}

            {failed.length > 0 && (
              <div className="callout warn">
                {card.disconnecting ? "Still holding the key: " : "Not yet applied to: "}
                {failed.map((a) => a.name || a.agent_id).join(", ")}
                <button
                  type="button"
                  className="btn"
                  style={{ marginLeft: 8 }}
                  disabled={busy}
                  onClick={() => void (card.disconnecting ? disconnect() : retry())}
                >
                  {card.disconnecting ? "Finish disconnecting" : "Retry"}
                </button>
              </div>
            )}

            {!card.disconnecting && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canSave) void save();
                }}
              >
                {fields ? (
                  fields.map((f) => (
                    <div className="field" key={f.name}>
                      <label htmlFor={`${card.provider}-${f.name}`}>{f.label}</label>
                      <input
                        id={`${card.provider}-${f.name}`}
                        className="input"
                        type={f.secret ? "password" : "text"}
                        autoComplete="off"
                        aria-label={`${card.provider} ${f.label}`}
                        value={values[f.name] || ""}
                        onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      />
                    </div>
                  ))
                ) : (
                  <div className="field">
                    <label htmlFor={`key-${card.provider}`}>API key</label>
                    <input
                      id={`key-${card.provider}`}
                      className="input"
                      type="password"
                      autoComplete="off"
                      aria-label={`${card.provider} API key`}
                      placeholder={card.connected ? `····${card.last4 ?? ""} — paste a new key to replace it` : "Paste an API key"}
                      value={values.api_key || ""}
                      onChange={(e) => setValues({ api_key: e.target.value })}
                    />
                    <p className="hint" style={{ margin: "4px 0 0" }}>
                      Stored encrypted and never shown again.
                    </p>
                  </div>
                )}
                {confirming ? (
                  <div className="callout warn" role="alertdialog" aria-label={`Disconnect ${card.provider}`}>
                    {disconnectText(card)}
                    <div className="modal-actions">
                      <button type="button" className="btn" onClick={() => setConfirming(false)}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void disconnect()}>
                        Confirm disconnect
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="modal-actions">
                    {card.connected && (
                      <button
                        type="button"
                        className="btn btn-danger-ghost"
                        disabled={busy}
                        onClick={() => setConfirming(true)}
                        style={{ marginRight: "auto" }}
                      >
                        Disconnect
                      </button>
                    )}
                    <button type="button" className="btn" onClick={close}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={busy || !canSave || !!stranded}>
                      {busy ? "Checking…" : card.connected ? "Replace key" : "Save key"}
                    </button>
                  </div>
                )}
              </form>
            )}
            {strandedPanel}
            {error && (
              <div className="callout error" role="alert">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProviderAccounts({ isAdmin }: { isAdmin: boolean }) {
  const [cards, setCards] = useState<ProviderCard[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      api("/integrations/providers")
        .then((r) => setCards(Array.isArray(r.data?.providers) ? r.data.providers : []))
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load provider accounts.")),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const onData = (next: ProviderCard[] | null) => (next ? setCards(next) : void load());

  // Carrier cards are not a group here: they are under Telephony, with Twilio's.
  const groups = GROUP_ORDER.filter((role) => role !== "carrier").map((role) => ({
    role,
    cards: cards.filter((c) => primaryRole(c) === role),
  })).filter((g) => g.cards.length);
  const carriers = cards.filter((c) => primaryRole(c) === "carrier");

  return (
    <>
      <section aria-labelledby="provider-accounts" className="int-section">
        <h3 id="provider-accounts">Provider accounts</h3>
        <p className="lead">
          Your own keys for the services an agent's calls run on — stored encrypted,
          checked when you save, never shown again. Without one, calls use the
          platform's key.
        </p>
        {!isAdmin && <p className="muted">Only workspace admins can enter or remove a key.</p>}
        {error && (
          <div className="callout error" role="alert">
            {error}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.role}>
            <div className="int-group-title">{ROLE_LABELS[g.role]}</div>
            <div className="integration-grid">
              {g.cards.map((card) => (
                <Card key={card.provider} card={card} isAdmin={isAdmin} onData={onData} />
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Every account a phone number runs on, whichever way it is stored: a
          Twilio account rides on each number TurnCall binds (ADR-0023), a
          Telnyx or Asterisk one is a project credential like the keys above. */}
      <section aria-labelledby="telephony" className="int-section">
        <h3 id="telephony">Telephony</h3>
        <p className="lead">
          The accounts your phone numbers call and answer on. Connect Twilio once,
          then pick its numbers when adding a phone number; a Telnyx or Asterisk
          account serves every number on that carrier.
        </p>
        {!isAdmin && <p className="muted">Only workspace admins can connect or remove an account.</p>}
        <div className="integration-grid">
          <TwilioCard isAdmin={isAdmin} />
          {carriers.map((card) => (
            <Card key={card.provider} card={card} isAdmin={isAdmin} onData={onData} />
          ))}
        </div>
      </section>
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { tint } from "../../apps";

// A Workspace's own provider accounts (ADR-0023, #44-#46).
//
// One card per provider *account*: Deepgram appears once and serves both
// transcription and voice. Entry is write-only — a saved key is never rendered
// back, only its presence and last four characters — and the card says which
// key a call will actually use, which is the point of the page.

export type Role = "llm" | "stt" | "tts" | "s2s" | "avatar";

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
};

export const ROLE_LABELS: Record<Role, string> = {
  llm: "Model",
  stt: "Transcription",
  tts: "Voice",
  s2s: "Speech-to-speech",
  avatar: "Avatar",
};
const ROLE_ORDER: Role[] = ["llm", "stt", "tts", "s2s", "avatar"];
// Which group a multi-role card is browsed under. Voice before Transcription:
// every TTS provider also transcribes, so the other way round empties Voice.
const GROUP_ORDER: Role[] = ["llm", "tts", "s2s", "stt", "avatar"];

const AWS_FIELDS = [
  { name: "access_key_id", label: "Access key ID", secret: false },
  { name: "secret_access_key", label: "Secret access key", secret: true },
  { name: "session_token", label: "Session token (optional)", secret: true },
  { name: "role_arn", label: "Role ARN (instead of keys)", secret: false },
  { name: "external_id", label: "External ID (with a role ARN)", secret: false },
  { name: "profile", label: "Profile on the TurnCall host (instead of keys)", secret: false },
  { name: "region", label: "Region (optional)", secret: false },
];

/** The sentence a card leads with: which key a call on this provider runs on. */
export function runsOnText(card: ProviderCard): string {
  switch (card.runs_on) {
    case "workspace":
      return `Calls use this workspace's key${card.last4 ? ` ····${card.last4}` : ""}.`;
    case "platform":
      return "Calls use the platform's key.";
    case "none":
      return "No key — neither this workspace nor the platform has one, so calls on it will fail.";
    default:
      return "Whether the platform has a key could not be checked.";
  }
}

/** What disconnecting will actually do, in words (#45). */
export function disconnectText(card: ProviderCard): string {
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
  const aws = card.provider === "aws";
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setValues({});
      setConfirming(false);
      onData(null); // reload
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const body = aws
    ? Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()))
    : { api_key: values.api_key || "" };
  // An AWS set has to name a source; a region alone changes nothing.
  const canSave = aws
    ? Boolean(body.access_key_id || body.role_arn || body.profile)
    : Boolean(values.api_key?.trim());

  const save = () =>
    run(() =>
      api(`/integrations/providers/${card.provider}`, { method: "PUT", body: JSON.stringify(body) }),
    );
  const disconnect = () =>
    run(() => api(`/integrations/providers/${card.provider}`, { method: "DELETE" }));
  const retry = () =>
    run(() => api(`/integrations/providers/${card.provider}/apply`, { method: "POST" }));
  const adopt = async (agentId: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await api(`/integrations/providers/${card.provider}/adopt`, {
        method: "POST",
        body: JSON.stringify({ agent_id: agentId }),
      });
      onData(r.data.providers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not adopt the key.");
    } finally {
      setBusy(false);
    }
  };

  const failed = card.agents.filter((a) => a.state === "failed" || a.state === "remove_failed");
  const pinned = card.pinned_agents.length;
  const roles = ROLE_ORDER.filter((r) => card.serves[r]?.length);
  const checked = validationText(card.validation);

  return (
    <div className="integration-card" data-testid={`provider-${card.provider}`}>
      <div className="head">
        <span className="app-tile" aria-hidden="true" style={{ background: tint(card.provider) }}>
          {card.provider.charAt(0).toUpperCase()}
        </span>
        <span className={`badge app-status ${card.connected ? "connected" : "disconnected"}`}>
          {card.disconnecting ? "Disconnecting" : card.connected ? "Workspace key" : "No workspace key"}
        </span>
      </div>
      <div className="name">{card.provider}</div>
      <div>
        {roles.map((r) => (
          <span key={r} className="chip" style={{ marginRight: 4 }}>
            {ROLE_LABELS[r]}
          </span>
        ))}
      </div>
      <p className={`desc${card.runs_on === "none" ? " danger" : ""}`}>{runsOnText(card)}</p>
      {card.connected && checked && <p className="desc">{checked}</p>}
      {pinned > 0 && (
        <p className="desc">
          {pinned === 1 ? "1 agent uses its own key" : `${pinned} agents use their own key`} for
          its model instead of this one.
        </p>
      )}
      {/* Adoption only fills an empty slot — it never replaces a workspace key. */}
      {isAdmin &&
        !card.connected &&
        card.pinned_agents.map((a) => (
          <div key={a.agent_id} className="foot">
            <span className="account-name">{a.name || a.agent_id}</span>
            <button type="button" className="btn" disabled={busy} onClick={() => void adopt(a.agent_id)}>
              Adopt into workspace
            </button>
          </div>
        ))}
      {failed.length > 0 && (
        <div className="callout warn">
          {card.disconnecting ? "Still holding the key: " : "Not yet applied to: "}
          {failed.map((a) => a.name || a.agent_id).join(", ")}
          {isAdmin && (
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 8 }}
              disabled={busy}
              onClick={() => void (card.disconnecting ? disconnect() : retry())}
            >
              {card.disconnecting ? "Finish disconnecting" : "Retry"}
            </button>
          )}
        </div>
      )}
      {isAdmin && !card.disconnecting && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) void save();
          }}
        >
          {aws ? (
            AWS_FIELDS.map((f) => (
              <input
                key={f.name}
                className="input"
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                aria-label={`${card.provider} ${f.label}`}
                placeholder={f.label}
                value={values[f.name] || ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                style={{ marginBottom: 4 }}
              />
            ))
          ) : (
            <input
              className="input"
              type="password"
              autoComplete="off"
              aria-label={`${card.provider} API key`}
              placeholder={card.connected ? "Paste a new key to replace it" : "Paste an API key"}
              value={values.api_key || ""}
              onChange={(e) => setValues({ api_key: e.target.value })}
            />
          )}
          <div className="foot" style={{ marginTop: 6 }}>
            <button type="submit" className="btn btn-primary" disabled={busy || !canSave}>
              {busy ? "Checking…" : card.connected ? "Replace key" : "Save key"}
            </button>
            {card.connected && !confirming && (
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirming(true)}>
                Disconnect
              </button>
            )}
          </div>
        </form>
      )}
      {confirming && (
        <div className="callout warn" role="alertdialog" aria-label={`Disconnect ${card.provider}`}>
          {disconnectText(card)}
          <div className="foot" style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void disconnect()}>
              Confirm disconnect
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="callout error" role="alert">
          {error}
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

  const groups = GROUP_ORDER.map((role) => ({
    role,
    cards: cards.filter((c) => primaryRole(c) === role),
  })).filter((g) => g.cards.length);

  return (
    <section aria-labelledby="provider-accounts">
      <h3 id="provider-accounts">Provider accounts</h3>
      <p className="hint">
        Your own keys for the services an agent's calls run on. A key is stored
        encrypted, checked when you save it, and never shown again — a card shows
        only its last four characters. A provider you have not connected runs on
        the platform's key, if it has one.
      </p>
      {!isAdmin && <p className="muted">Only workspace admins can enter or remove a key.</p>}
      {error && (
        <div className="callout error" role="alert">
          {error}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.role}>
          <h4>{ROLE_LABELS[g.role]}</h4>
          <div className="integration-grid">
            {g.cards.map((card) => (
              <Card key={card.provider} card={card} isAdmin={isAdmin} onData={onData} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

import { useEffect, useState } from "react";
import { Ambience } from "./Ambience";
import { Avatar } from "./Avatar";
import { Backups } from "./Backups";
import { LlmTuning } from "./LlmTuning";
import { Pronunciations } from "./Pronunciations";
import { withField } from "./SettingFields";
import { TurnTaking } from "./TurnTaking";
import { Delegation } from "./Delegation";
import { McpServers } from "./McpServers";
import type { RegisteredServer } from "../integrations/McpRegistry";
import { ProviderKeyNote, type ProviderCard } from "./ProviderKeyNote";
import {
  ConnectedApps,
  type AttachmentValue,
  type CatalogApp,
  type ConnectedAccount,
  type AutomationRun,
} from "./ConnectedApps";
import { Section } from "./Section";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { canEdit } from "../../roles";
import { useAgent } from "./AgentPage";

type Providers = { stt: string[]; llm: string[]; tts: string[]; s2s: string[] };
const FALLBACK_PROVIDERS: Providers = {
  stt: ["deepgram", "openai", "elevenlabs", "cartesia"],
  llm: ["openai", "anthropic", "openrouter", "ollama", "custom_openai", "bedrock"],
  tts: ["deepgram", "openai", "elevenlabs", "cartesia"],
  s2s: ["openai", "openai_live", "google", "aws"],
};

// A raw provider id is only self-explanatory when it names a vendor. Several
// name an *integration* instead: `openai` and `openai_live` are two different
// OpenAI protocols (Realtime vs the full-duplex Live API), and bedrock /
// openrouter / custom_openai are gateways rather than vendors. Label those;
// leave the plain vendor names alone. Keyed by role because `openai` means
// something different under stt than under s2s.
const PROVIDER_LABELS: Record<keyof Providers, Record<string, string>> = {
  stt: {},
  tts: {},
  llm: {
    openrouter: "openrouter — multi-model routing with fallback",
    ollama: "ollama — local models",
    custom_openai: "custom_openai — any OpenAI-compatible endpoint",
    bedrock: "bedrock — AWS-hosted models (gateway)",
  },
  s2s: {
    openai: "openai — Realtime, turn-based",
    openai_live: "openai_live — GPT-Live-1, full duplex (handles interruptions)",
    google: "google — Gemini Live",
    aws: "aws — Amazon Nova Sonic",
  },
};

const providerOptions = (role: keyof Providers, list: string[]) =>
  list.map((p) => (
    <option key={p} value={p}>
      {PROVIDER_LABELS[role][p] ?? p}
    </option>
  ));

const STATUS_HINTS: Record<string, string> = {
  degraded: "running, but event/tool verification is unconfigured (webhook registration failed) — the backend rejects unsigned traffic, so no events will appear",
  failed: "the backend container failed to start — press Save to retry generation (root cause is in the builder API logs: make docker-logs)",
  stopped: "the backend container is not running — calls to this agent's tools and events will fail until it's started",
};

const BUILTIN_TOOLS = ["end_call", "transfer_call", "send_dtmf", "do_not_call"];

const clone = (o: unknown) => JSON.parse(JSON.stringify(o ?? {}));

// An option is either a bare id (models) or {value,label} (voices where the
// config value is an id but we show a friendly name, e.g. ElevenLabs/Cartesia).
type Opt = string | { value: string; label: string };

// Live options -> real <select> (a datalist gave no visible dropdown to choose from).
// Empty list (ollama/custom, or a provider with no key) -> free text.
function PickField({ id, label, value, options, placeholder, onChange }: {
  id: string; label: string; value: string; options: Opt[];
  placeholder: string; onChange: (v: string) => void;
}) {
  if (options.length === 0) {
    return (
      <div className="field" style={{ flex: 1 }}>
        <label htmlFor={id}>{label}</label>
        <input id={id} className="input" value={value}
          onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      </div>
    );
  }
  const norm = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  // Keep the current value selectable even if it's not in the fetched list.
  const opts = value && !norm.some((o) => o.value === value)
    ? [{ value, label: value }, ...norm]
    : norm;
  return (
    <div className="field" style={{ flex: 1 }}>
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— select —</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// Order-insensitive custom_tools comparison — mirrors the API's regen trigger.
function toolsChanged(a: unknown, b: unknown): boolean {
  const norm = (c: any) =>
    JSON.stringify(
      ((c || {}).custom_tools || [])
        .slice()
        .sort((x: any, y: any) => String(x.name).localeCompare(String(y.name)))
    );
  return norm(a) !== norm(b);
}

export default function ConfigTab() {
  const { agentId, data, updateConfig } = useAgent();
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role); // viewers can view but not save
  const [cfg, setCfg] = useState<any>(() => clone(data.config));
  const [advanced, setAdvanced] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  // A refusal is not a status line. Save failures say what to fix, and reading
  // them as grey body text running the width of the page is how a sentence like
  // "Post the call summary needs a Channel" gets missed.
  const [err, setErr] = useState("");
  const [providers, setProviders] = useState<Providers>(FALLBACK_PROVIDERS);
  const [sttModels, setSttModels] = useState<string[]>([]); // live, for the selected STT provider
  const [models, setModels] = useState<string[]>([]); // live, for the selected LLM provider
  const [voices, setVoices] = useState<Opt[]>([]); // live, for the selected TTS provider
  const [s2sModels, setS2sModels] = useState<string[]>([]); // live, for the selected S2S provider
  const [s2sVoices, setS2sVoices] = useState<Opt[]>([]);
  const [catalog, setCatalog] = useState<CatalogApp[]>([]);
  const [connected, setConnected] = useState<ConnectedAccount[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [registered, setRegistered] = useState<RegisteredServer[]>([]);
  // Which key each provider would run on (#48). Unloaded = no notes at all.
  const [cards, setCards] = useState<ProviderCard[]>([]);

  useEffect(() => {
    api("/providers").then((r) => setProviders(r.data)).catch(() => {});
  }, []);

  // Integrations are optional: an unconfigured deployment answers 503 here, and
  // the picker then renders its empty state rather than an error.
  useEffect(() => {
    api("/integrations/catalog").then((r) => setCatalog(r.data)).catch(() => {});
    api("/integrations").then((r) => setConnected(r.data)).catch(() => {});
    api("/integrations/mcp-servers")
      .then((r) => setRegistered(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
    api("/integrations/providers")
      .then((r) => setCards(Array.isArray(r.data?.providers) ? r.data.providers : []))
      .catch(() => {});
  }, []);

  // What this agent's Automations actually did (#47). Straight from the
  // generated backend, the way the Calls tab reads its `/events` — the builder
  // is not in the event path, so nothing here knows but that container.
  //
  // Unreachable stays empty rather than becoming an error: this is a status line
  // beside a setting, and a backend that is merely stopped must not make the
  // whole configuration page look broken.
  const browserUrl = data.backend?.browser_url;
  useEffect(() => {
    if (!browserUrl) return;
    let live = true;
    // Same trap as the Calls tab's event feed: a direct hop to the agent's
    // container, which can accept a connection and never answer.
    fetch(`${browserUrl}/automations`, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (live && b) setRuns(b.data.runs); })
      .catch(() => {});
    return () => { live = false; };
  }, [browserUrl]);

  const isS2S = (cfg.pipeline_mode || "cascade") === "s2s";
  // Placeholder hints per S2S provider — OpenAI's would be actively misleading
  // next to a Nova Sonic or Gemini dropdown.
  const S2S_HINTS: Record<string, { model: string; voice: string }> = {
    openai: { model: "gpt-realtime-2.1", voice: "alloy" },
    openai_live: { model: "gpt-live-1", voice: "alloy" },
    google: { model: "models/gemini-3.1-flash-live-preview", voice: "Charon" },
    aws: { model: "amazon.nova-2-sonic-v1:0", voice: "matthew" },
  };

  // Fetch S2S model + voice lists whenever the S2S provider changes.
  const s2sProvider = cfg.s2s?.provider || "openai";
  useEffect(() => {
    let ok = true;
    api(`/providers/s2s/${s2sProvider}/models`)
      .then((r) => ok && setS2sModels(r.data.models || []))
      .catch(() => ok && setS2sModels([]));
    api(`/providers/s2s/${s2sProvider}/voices`)
      .then((r) => ok && setS2sVoices(r.data.voices || []))
      .catch(() => ok && setS2sVoices([]));
    return () => {
      ok = false;
    };
  }, [s2sProvider]);

  // Fetch the STT model list live whenever the STT provider changes.
  const sttProvider = cfg.stt?.provider || "deepgram";
  useEffect(() => {
    let ok = true;
    api(`/providers/stt/${sttProvider}/models`)
      .then((r) => ok && setSttModels(r.data.models || []))
      .catch(() => ok && setSttModels([]));
    return () => {
      ok = false;
    };
  }, [sttProvider]);

  // openai_live's delegate is an OpenAI-hosted Responses model, so it picks
  // from the workspace's OpenAI list whatever the agent's own LLM provider is.
  const [delegateModels, setDelegateModels] = useState<string[]>([]);
  const wantsDelegateModels = (cfg.s2s?.provider || "openai") === "openai_live";
  useEffect(() => {
    if (!wantsDelegateModels) return;
    let ok = true;
    api(`/providers/llm/openai/models`)
      .then((r) => ok && setDelegateModels(r.data.models || []))
      .catch(() => ok && setDelegateModels([]));
    return () => {
      ok = false;
    };
  }, [wantsDelegateModels]);

  // Fetch the model list live whenever the LLM provider changes.
  const llmProvider = cfg.llm?.provider || "openai";
  useEffect(() => {
    let ok = true;
    api(`/providers/llm/${llmProvider}/models`)
      .then((r) => ok && setModels(r.data.models || []))
      .catch(() => ok && setModels([]));
    return () => {
      ok = false;
    };
  }, [llmProvider]);

  // Bedrock (LLM) and Nova Sonic (S2S) share one aws block, so the region field
  // shows for either.
  const usesAws = isS2S ? s2sProvider === "aws" : llmProvider === "bedrock";

  // Fetch the voice list live whenever the TTS provider changes.
  const ttsProvider = cfg.tts?.provider || "deepgram";
  useEffect(() => {
    let ok = true;
    api(`/providers/tts/${ttsProvider}/voices`)
      .then((r) => ok && setVoices(r.data.voices || []))
      .catch(() => ok && setVoices([]));
    return () => {
      ok = false;
    };
  }, [ttsProvider]);

  // Immutable nested edit: clone, mutate the copy, set.
  const patch = (fn: (c: any) => void) =>
    setCfg((c: any) => {
      const next = clone(c);
      fn(next);
      return next;
    });

  function enterAdvanced() {
    setJsonText(JSON.stringify(cfg, null, 2));
    setJsonError("");
    setAdvanced(true);
  }
  function onJson(text: string) {
    setJsonText(text);
    try {
      setCfg(JSON.parse(text));
      setJsonError("");
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "invalid JSON");
    }
  }

  async function save() {
    setMsg("");
    if (advanced && jsonError) {
      setMsg(`Config is not valid JSON: ${jsonError}`);
      return;
    }
    if (
      toolsChanged(data.config, cfg) &&
      !confirm(
        "Changing tools regenerates the backend's app.py, overwriting handler edits in the generated repo.\n\nYour edits are committed to git first (recoverable with `git log`). Continue?"
      )
    )
      return;
    setSaving(true);
    setErr("");
    try {
      const r = await api(`/agents/${agentId}`, { method: "PUT", body: JSON.stringify({ config: cfg }) });
      updateConfig(cfg);
      setMsg(
        r.data?.backend_regenerated
          ? "Saved — backend regenerated (tools changed); previous handler code is in git history."
          : "Saved."
      );
    } catch (e) {
      setMsg("");
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const tools: string[] = Array.isArray(cfg.tools) ? cfg.tools : [];
  const customCount = (cfg.custom_tools || []).length;
  const topics: string[] = cfg.guardrails?.prohibited_topics || [];

  // The agent's LLM: cascade's middle stage, and openai_live's default delegate,
  // where it runs the tools rather than the conversation — labelled as such.
  const llmFields = (asDelegate: boolean) => (
    <>
      <div style={{ display: "flex", gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="cfg-llm-p">{asDelegate ? "Delegate LLM" : "LLM provider"}</label>
          <select
            id="cfg-llm-p"
            className="input"
            value={cfg.llm?.provider || "openai"}
            onChange={(e) => patch((c) => (c.llm = { ...c.llm, provider: e.target.value }))}
          >
            {providerOptions("llm", providers.llm)}
          </select>
          <ProviderKeyNote role="llm" provider={llmProvider} cards={cards} pinned={Boolean(cfg.llm?.api_key)} />
        </div>
        <PickField
          id="cfg-llm-m"
          label={asDelegate ? "Delegate model" : "Model"}
          value={cfg.llm?.model || ""}
          options={models}
          placeholder="gpt-4o-mini"
          onChange={(v) => patch((c) => (c.llm = { ...c.llm, model: v }))}
        />
      </div>
      {asDelegate && (
        <p className="hint" style={{ margin: "2px 0 0" }}>
          Runs the agent's tools; GPT-Live-1 does the talking. Optional: left as is, it is
          OpenAI gpt-4o-mini. A blank model uses the provider's default.
        </p>
      )}
    </>
  );

  const statusHint = data.backend ? STATUS_HINTS[data.backend.status] : undefined;
  const toolStatuses = data.tool_statuses;
  const stubs = Object.entries(toolStatuses || {}).filter(([, s]) => s === "stub");

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {statusHint && <p className="callout warn">{statusHint}</p>}
      {toolStatuses && Object.keys(toolStatuses).length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {Object.entries(toolStatuses).map(([name, s]) => (
            <span key={name} className={`chip ${s}`}>{name} · {s}</span>
          ))}
          {stubs.length > 0 && (
            <p className="hint" style={{ margin: "2px 0 0" }}>
              Stub tools return fake data — fill in real logic in the generated repo.
            </p>
          )}
        </div>
      )}
      {Object.values(toolStatuses || {}).includes("external") && data.tool_signing_secret && (
        <div className="callout info">
          <strong>Tool signing secret</strong>
          <p>
            Tools marked <code>external</code> POST to your server, signed with{" "}
            <code>X-TurnCall-Signature</code> (HMAC-SHA256 over{" "}
            <code>{"{timestamp}.{body}"}</code>). Verify with this secret:
          </p>
          <code className="block">{data.tool_signing_secret}</code>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, margin: "2px 0 12px" }}>
        <button className={`btn${!advanced ? " btn-primary" : ""}`} onClick={() => setAdvanced(false)}>Form</button>
        <button className={`btn${advanced ? " btn-primary" : ""}`} onClick={enterAdvanced}>Advanced (JSON)</button>
      </div>

      {advanced ? (
        <>
          <textarea
            className="input code"
            style={{ flex: 1 }}
            aria-label="Agent configuration JSON"
            value={jsonText}
            onChange={(e) => onJson(e.target.value)}
          />
     {jsonError && <p className="error-text">Invalid JSON: {jsonError}</p>}
        </>
      ) : (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <Section id="prompt" title="Prompt">
          <div className="field">
            <label htmlFor="cfg-prompt">System prompt</label>
            <textarea
              id="cfg-prompt"
              className="input"
              style={{ minHeight: 150 }}
              value={cfg.system_prompt || ""}
              onChange={(e) => patch((c) => (c.system_prompt = e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="cfg-first">First message</label>
            <input
              id="cfg-first"
              className="input"
              value={cfg.first_message || ""}
              onChange={(e) => patch((c) => (c.first_message = e.target.value || null))}
              placeholder="What the agent says first (blank = caller speaks first)"
            />
          </div>
          </Section>

          <Section
            id="models"
            title="Speech and models"
            hint={isS2S ? "speech-to-speech" : "cascade"}
          >
          <div className="field">
            <label htmlFor="cfg-mode">Pipeline mode</label>
            <select
              id="cfg-mode"
              className="input"
              value={cfg.pipeline_mode || "cascade"}
              onChange={(e) => patch((c) => (c.pipeline_mode = e.target.value))}
            >
              <option value="cascade">cascade (STT → LLM → TTS)</option>
              <option value="s2s">speech-to-speech (single realtime model)</option>
            </select>
          </div>

          {isS2S ? (
            <>
            <div style={{ display: "flex", gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="cfg-s2s-p">S2S provider</label>
                <select
                  id="cfg-s2s-p"
                  className="input"
                  value={cfg.s2s?.provider || "openai"}
                  onChange={(e) =>
                    patch((c) => {
                      // Only openai_live delegates; TurnCall refuses the block elsewhere.
                      const { delegation, ...rest } = c.s2s || {};
                      const provider = e.target.value;
                      c.s2s = provider === "openai_live" && delegation
                        ? { ...rest, provider, delegation }
                        : { ...rest, provider };
                    })
                  }
                >
                  {providerOptions("s2s", providers.s2s)}
                </select>
                <ProviderKeyNote role="s2s" provider={s2sProvider} cards={cards} />
              </div>
              <PickField
                id="cfg-s2s-m"
                label="S2S model"
                value={cfg.s2s?.model || ""}
                options={s2sModels}
                placeholder={(S2S_HINTS[s2sProvider] || S2S_HINTS.openai).model}
                onChange={(v) => patch((c) => (c.s2s = { ...c.s2s, model: v }))}
              />
              <PickField
                id="cfg-s2s-v"
                label="Voice"
                value={cfg.s2s?.voice || ""}
                options={s2sVoices}
                placeholder={(S2S_HINTS[s2sProvider] || S2S_HINTS.openai).voice}
                onChange={(v) => patch((c) => (c.s2s = { ...c.s2s, voice: v }))}
              />
            </div>
            {s2sProvider === "openai_live" && (
              <Delegation
                value={cfg.s2s?.delegation}
                models={delegateModels}
                hasTools={
                  tools.length > 0 ||
                  customCount > 0 ||
                  (cfg.mcp_servers || []).length > 0 ||
                  (cfg.workspace_mcp_servers || []).length > 0
                }
                llmPicker={llmFields(true)}
                editable={editable}
                onChange={(d) =>
                  patch((c) => {
                    const { delegation: _old, ...rest } = c.s2s || {};
                    c.s2s = d ? { ...rest, delegation: d } : rest;
                  })
                }
              />
            )}
            </>
          ) : (
          <>
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="cfg-stt-p">STT provider</label>
              <select
                id="cfg-stt-p"
                className="input"
                value={cfg.stt?.provider || "deepgram"}
                onChange={(e) => patch((c) => (c.stt = { ...c.stt, provider: e.target.value }))}
              >
                {providerOptions("stt", providers.stt)}
              </select>
              <ProviderKeyNote role="stt" provider={sttProvider} cards={cards} />
            </div>
            <PickField
              id="cfg-stt-m"
              label="STT model"
              value={cfg.stt?.model || ""}
              options={sttModels}
              placeholder="nova-2"
              onChange={(v) => patch((c) => (c.stt = { ...c.stt, model: v }))}
            />
          </div>
          <Backups role="stt" providers={providers.stt} value={cfg.stt?.failover} editable={editable}
            onChange={(f) => patch((c) => (c.stt = withField(c.stt, "failover", f)))} />
          {llmFields(false)}
          <LlmTuning value={cfg.llm} onChange={(llm) => patch((c) => (c.llm = llm))} />
          <Backups role="llm" providers={providers.llm} value={cfg.llm?.failover} editable={editable}
            onChange={(f) => patch((c) => (c.llm = withField(c.llm, "failover", f)))} />
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="cfg-tts-p">TTS provider</label>
              <select
                id="cfg-tts-p"
                className="input"
                value={cfg.tts?.provider || "deepgram"}
                onChange={(e) => patch((c) => (c.tts = { ...c.tts, provider: e.target.value }))}
              >
                {providerOptions("tts", providers.tts)}
              </select>
              <ProviderKeyNote role="tts" provider={ttsProvider} cards={cards} />
            </div>
            <PickField
              id="cfg-tts-v"
              label="Voice"
              value={cfg.tts?.voice || ""}
              options={voices}
              placeholder="aura-2-helena-en"
              onChange={(v) => patch((c) => (c.tts = { ...c.tts, voice: v }))}
            />
          </div>
          <Backups role="tts" providers={providers.tts} value={cfg.tts?.failover} editable={editable}
            onChange={(f) => patch((c) => (c.tts = withField(c.tts, "failover", f)))} />
          <Pronunciations
            value={cfg.tts?.pronunciations}
            warnings={(data.turncall_agent?.warnings || [])
              .filter((w) => w.code.startsWith("pronunciation"))
              .map((w) => w.message)}
            editable={editable}
            onChange={(m) => patch((c) => (c.tts = withField(c.tts, "pronunciations", m)))}
          />
          </>
          )}
          {usesAws && (
            <div style={{ display: "flex", gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="cfg-aws-region">AWS region</label>
                <input
                  id="cfg-aws-region"
                  className="input"
                  value={cfg.aws?.region || ""}
                  placeholder="us-east-1"
                  onChange={(e) =>
                    patch((c) => {
                      const region = e.target.value.trim();
                      if (region) c.aws = { ...c.aws, region };
                      else delete c.aws;
                    })
                  }
                />
                <p className="hint" style={{ margin: "4px 0 0" }}>
                  Bedrock model availability is region-specific, and access is granted
                  per model per region. Leave blank to use the server's AWS_REGION.
                  Credentials are never entered in this form: an admin connects an
                  AWS credential set on the Integrations page, and without one the
                  server's own AWS credentials are used.
                </p>
              </div>
            </div>
          )}
          </Section>

          <Section id="turn-taking" title="Turn-taking and call limits">
            <TurnTaking cfg={cfg} isS2S={isS2S} editable={editable}
              onSet={(key, v) => setCfg((c: any) => withField(c, key, v))} />
          </Section>

          {!isS2S && (
            <Section id="avatar" title="Video avatar" hint={cfg.avatar?.enabled ? cfg.avatar.provider : ""}>
              <Avatar value={cfg.avatar} editable={editable}
                onChange={(a) => setCfg((c: any) => withField(c, "avatar", a))} />
            </Section>
          )}

          <Section
            id="builtin-tools"
            title="Built-in tools"
            hint={tools.length || ""}
          >
            <div className="radio-row">
              {BUILTIN_TOOLS.map((name) => (
                <label key={name}>
                  <input
                    type="checkbox"
                    checked={tools.includes(name)}
                    onChange={(e) =>
                      patch((c) => {
                        const set = new Set(Array.isArray(c.tools) ? c.tools : []);
                        e.target.checked ? set.add(name) : set.delete(name);
                        c.tools = [...set];
                      })
                    }
                  />{" "}
                  {name}
                </label>
              ))}
            </div>
          </Section>

          <Section id="guardrails" title="Guardrails" hint={topics.length || ""}>
          <div className="field">
            <label htmlFor="cfg-topics">Prohibited topics</label>
            <input
              id="cfg-topics"
              className="input"
              value={topics.join(", ")}
              onChange={(e) =>
                patch((c) => {
                  const list = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                  c.guardrails = { ...c.guardrails, prohibited_topics: list };
                })
              }
              placeholder="e.g. medical advice, competitor pricing"
            />
            <p className="hint" style={{ margin: "4px 0 0" }}>
              Comma-separated — the agent refuses to discuss these.
            </p>
          </div>
          </Section>

          <ConnectedApps
            apps={Array.isArray(cfg.integrations) ? (cfg.integrations as AttachmentValue[]) : []}
            needs={Array.isArray(cfg.needs_integrations) ? (cfg.needs_integrations as string[]) : []}
            catalog={catalog}
            connected={connected}
            runs={runs}
            editable={editable}
            onChange={(apps) =>
              patch((c) => {
                // Same rule as mcp_servers: omit the key rather than sending an
                // empty array, so "none" is a removal and not a no-op.
                if (apps.length) c.integrations = apps;
                else delete c.integrations;
              })
            }
          />
          <McpServers
            servers={Array.isArray(cfg.mcp_servers) ? cfg.mcp_servers : []}
            registered={registered}
            selected={Array.isArray(cfg.workspace_mcp_servers) ? cfg.workspace_mcp_servers : []}
            onSelect={(ids) =>
              patch((c) => {
                // Same omit-when-empty rule as mcp_servers below.
                if (ids.length) c.workspace_mcp_servers = ids;
                else delete c.workspace_mcp_servers;
              })
            }
            editable={editable}
            onChange={(servers) =>
              patch((c) => {
                // Omit the key entirely when empty rather than sending [] — the
                // mapper only forwards it when present, so an empty array would
                // read as "no change" rather than "remove them".
                if (servers.length) c.mcp_servers = servers;
                else delete c.mcp_servers;
              })
            }
          />
          <Ambience
            agentId={agentId}
            value={cfg.ambience || undefined}
            savedSound={(data.config as { ambience?: { sound?: string } } | null)?.ambience?.sound}
            editable={editable}
            onChange={(next) =>
              patch((c) => {
                // Absence is TurnCall's "off" — never send a null block.
                if (next) c.ambience = next;
                else delete c.ambience;
              })
            }
          />
          <Section
            id="tool-server"
            title="Tool server"
            hint={cfg.server_url ? "your server" : "generated backend"}
          >
          <div className="field">
            <label htmlFor="cfg-server-url">Tool server URL</label>
            <input
              id="cfg-server-url"
              className="input"
              value={cfg.server_url || ""}
              onChange={(e) => patch((c) => (c.server_url = e.target.value || null))}
              placeholder="https://your-server.example (blank = generated backend)"
            />
            <p className="hint" style={{ margin: "4px 0 0" }}>
              Where the agent's custom tools POST. Leave blank to use the generated backend.
            </p>
          </div>
     <p className="hint">
            {customCount > 0 ? `${customCount} custom tool${customCount > 1 ? "s" : ""}. ` : ""}
            Custom tools, speech-to-speech, voicemail, and analysis live in{" "}
            <strong>Advanced (JSON)</strong>.
          </p>
          </Section>
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !editable}>
          {saving ? "Saving…" : "Save"}
        </button>
        <span aria-live="polite" className="muted" style={{ fontSize: 13 }}>
          {editable ? msg : "Read-only — viewers can't edit agents."}
        </span>
      </div>
      {err && (
        <div className="callout error" role="alert" style={{ marginTop: 10 }}>
          <strong>Not saved.</strong> {err}
        </div>
      )}
    </div>
  );
}

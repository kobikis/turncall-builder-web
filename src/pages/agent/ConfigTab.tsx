import { useEffect, useState } from "react";
import { Ambience } from "./Ambience";
import { AgentSkills } from "./AgentSkills";
import { Avatar } from "./Avatar";
import { Backups } from "./Backups";
import { PickControl, type Opt } from "./PickControl";
import { LlmTuning } from "./LlmTuning";
import { Limits } from "./Limits";
import { Pronunciations } from "./Pronunciations";
import { NumberField, withField } from "./SettingFields";
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
import { api } from "../../api";
import { useAuth } from "../../auth";
import { canEdit } from "../../roles";
import { useAgent } from "./AgentPage";
import type { SectionId } from "./sections";

type Providers = { stt: string[]; llm: string[]; tts: string[]; s2s: string[] };
const FALLBACK_PROVIDERS: Providers = {
  stt: ["deepgram", "openai", "elevenlabs", "cartesia", "assemblyai", "xai"],
  llm: ["openai", "anthropic", "google", "openrouter", "ollama", "custom_openai", "bedrock", "xai"],
  tts: ["deepgram", "openai", "elevenlabs", "cartesia", "xai"],
  s2s: ["openai", "openai_live", "google", "aws", "xai"],
};

// A raw provider id is only self-explanatory when it names a vendor. Several
// name an *integration* instead: `openai` and `openai_live` are two different
// OpenAI protocols (Realtime vs the full-duplex Live API), and bedrock /
// openrouter / custom_openai are gateways rather than vendors. Label those;
// leave the plain vendor names alone. Keyed by role because `openai` means
// something different under stt than under s2s.
const PROVIDER_LABELS: Record<keyof Providers, Record<string, string>> = {
  stt: { xai: "xai — speech-to-text" },
  tts: { xai: "xai — voices" },
  llm: {
    google: "google — Gemini",
    xai: "xai — Grok",
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
    xai: "xai — Grok Voice",
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

// A model its vendor has deprecated still runs, so it stays pickable — named as
// such, from the catalog's own `deprecated` list (builder-api#121).
export const s2sModelOptions = (models: string[], deprecated: string[]): Opt[] =>
  models.map((m) => (deprecated.includes(m) ? { value: m, label: `${m} (deprecated)` } : m));

// Placeholder hints per cascade provider: TurnCall's own default where it has
// one we pin (a blank field runs it), else the long-standing example.
const STT_MODEL_HINTS: Record<string, string> = { xai: "grok-voice-transcribe-2.0" };
const LLM_MODEL_HINTS: Record<string, string> = { xai: "grok-4.20-non-reasoning" };
const TTS_VOICE_HINTS: Record<string, string> = { xai: "eve" };

// Deepgram's voice is its model, and xAI's TTS has no model at all: a voice only.
const TTS_VOICE_ONLY = ["deepgram", "xai"];

// The voice speeds each TTS provider takes. TurnCall's own bound is 0.25–4.0;
// xAI accepts 0.7–1.5 only, and TurnCall refuses anything outside it (422).
type Range = { min: number; max: number };
const SPEED_RANGE: Range = { min: 0.25, max: 4 };
const TTS_SPEED_RANGES: Record<string, Range> = { xai: { min: 0.7, max: 1.5 } };
const speedRange = (provider: string) => TTS_SPEED_RANGES[provider] ?? SPEED_RANGE;

/** A speed the new provider accepts: one outside its range is brought to the nearest bound. */
const speedFor = (provider: string, speed: unknown): unknown => {
  if (typeof speed !== "number") return speed;
  const { min, max } = speedRange(provider);
  return Math.min(max, Math.max(min, speed));
};

// Only xAI's narrower range is worth saying out loud; outside it, say what will happen.
const speedHint = (provider: string, speed: unknown): string | undefined => {
  const range = TTS_SPEED_RANGES[provider];
  if (!range) return undefined;
  const span = `${range.min}–${range.max}`;
  const outside = typeof speed === "number" && (speed < range.min || speed > range.max);
  return outside
    ? `${speed} is outside the ${span} xAI accepts — TurnCall will refuse to save it.`
    : `xAI accepts ${span}. Blank is 1.0.`;
};

const BUILTIN_TOOLS = ["end_call", "transfer_call", "send_dtmf", "do_not_call"];

function PickField({ id, label, value, options, placeholder, onChange }: {
  id: string; label: string; value: string; options: Opt[];
  placeholder: string; onChange: (v: string) => void;
}) {
  return (
    <div className="field" style={{ flex: 1 }}>
      <label htmlFor={id}>{label}</label>
      <PickControl id={id} value={value} options={options} placeholder={placeholder} onChange={onChange} />
    </div>
  );
}

// What each section is for, under its heading.
const LEADS: Partial<Record<SectionId, string>> = {
  prompt: "What the agent knows and how it behaves on every call.",
  models: "How the agent hears, thinks and speaks.",
  tools: "What the agent can do during a call.",
  skills:
    "Workspace skills the agent can load mid-call. It sees each one's name and when to use it, and loads its instructions and tools when it needs them.",
  "turn-taking": "When the caller's turn ends, when the call ends, and how much it may use.",
  guardrails: "What the agent will not discuss.",
  avatar: "A lip-synced face for browser calls.",
  advanced: "The whole configuration. Custom tools, voicemail and analysis are edited here.",
};

const TITLES: Partial<Record<SectionId, string>> = {
  prompt: "Prompt",
  models: "Speech and models",
  tools: "Tools and apps",
  skills: "Skills",
  "turn-taking": "Turn-taking and limits",
  guardrails: "Guardrails",
  avatar: "Video avatar",
  advanced: "Advanced (JSON)",
};

// One section of the agent's configuration. The draft and its save live in
// AgentPage; this edits the part of it the section owns.
export default function ConfigTab({ section }: { section: SectionId }) {
  const { agentId, data, draft: cfg, patch, setDraft: setCfg, saveErrors } = useAgent();
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role); // viewers can view but not save
  const [providers, setProviders] = useState<Providers>(FALLBACK_PROVIDERS);
  const [sttModels, setSttModels] = useState<string[]>([]); // live, for the selected STT provider
  const [models, setModels] = useState<string[]>([]); // live, for the selected LLM provider
  const [voices, setVoices] = useState<Opt[]>([]); // live, for the selected TTS provider
  const [ttsModels, setTtsModels] = useState<string[]>([]); // for the selected TTS provider
  const [s2sModels, setS2sModels] = useState<Opt[]>([]); // live, for the selected S2S provider
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

  // What this agent's Automations actually did (#47). From the generated
  // backend, relayed by the API the way the Calls tab reads its `/events` —
  // the builder is not in the event path, so nothing but the backend knows.
  //
  // Unreachable stays empty rather than becoming an error: this is a status line
  // beside a setting, and a backend that is merely stopped must not make the
  // whole configuration page look broken.
  const browserUrl = data.backend?.browser_url;
  useEffect(() => {
    if (!browserUrl) return;
    let live = true;
    // Same trap as the Calls tab's event feed: relayed to the agent's
    // backend, which can accept a connection and never answer.
    api(`${browserUrl}/automations`, { signal: AbortSignal.timeout(5000) })
      .then((b) => { if (live && b) setRuns(b.data.runs); })
      .catch(() => {});
    return () => { live = false; };
  }, [browserUrl]);

  const isS2S = (cfg.pipeline_mode || "cascade") === "s2s";
  // Placeholder hints per S2S provider — OpenAI's would be actively misleading
  // next to a Nova Sonic, Gemini or Grok dropdown.
  const S2S_HINTS: Record<string, { model: string; voice: string }> = {
    openai: { model: "gpt-realtime-2.1", voice: "alloy" },
    openai_live: { model: "gpt-live-1", voice: "alloy" },
    google: { model: "models/gemini-3.1-flash-live-preview", voice: "Charon" },
    aws: { model: "amazon.nova-2-sonic-v1:0", voice: "matthew" },
    // Pinned, as TurnCall runs it, never xAI's moving `grok-voice-latest`.
    xai: { model: "grok-voice-3.0", voice: "eve" },
  };

  // Fetch S2S model + voice lists whenever the S2S provider changes.
  const s2sProvider = cfg.s2s?.provider || "openai";
  useEffect(() => {
    let ok = true;
    api(`/providers/s2s/${s2sProvider}/models`)
      .then((r) => ok && setS2sModels(s2sModelOptions(r.data.models || [], r.data.deprecated || [])))
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
    api(`/providers/tts/${ttsProvider}/models`)
      .then((r) => ok && setTtsModels(r.data.models || []))
      .catch(() => ok && setTtsModels([]));
    return () => {
      ok = false;
    };
  }, [ttsProvider]);

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
            onChange={(e) => patch((c) => (c.llm = { ...c.llm, provider: e.target.value, model: "" }))}
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
          placeholder={LLM_MODEL_HINTS[llmProvider] ?? "gpt-4o-mini"}
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
    <section aria-labelledby="cfg-h" className="wb-section">
      <h2 id="cfg-h">{TITLES[section]}</h2>
      {LEADS[section] && <p className="muted lead">{LEADS[section]}</p>}
      {statusHint && <p className="callout warn">{statusHint}</p>}

      {section === "prompt" && (<>
        <div className="field">
          <label htmlFor="cfg-prompt">System prompt</label>
          <textarea
            id="cfg-prompt"
            className="input"
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
      </>)}

      {section === "models" && (<>
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
        {isS2S && Array.isArray(cfg.skills) && cfg.skills.length > 0 && (
          <p className="callout warn">
            This agent's skills ({cfg.skills.map((s: { skill: string }) => s.skill).join(", ")}) are not
            loaded in speech-to-speech: TurnCall skips them on its calls. Switch back to cascade to use them.
          </p>
        )}

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
              onChange={(e) => patch((c) => (c.stt = { ...c.stt, provider: e.target.value, model: "" }))}
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
            placeholder={STT_MODEL_HINTS[sttProvider] ?? "nova-2"}
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
              onChange={(e) =>
                patch((c) => {
                  const provider = e.target.value;
                  c.tts = withField(
                    { ...c.tts, provider, model: "", voice: "" },
                    "speed",
                    speedFor(provider, c.tts?.speed),
                  );
                })
              }
            >
              {providerOptions("tts", providers.tts)}
            </select>
            <ProviderKeyNote role="tts" provider={ttsProvider} cards={cards} />
          </div>
          {/* Deepgram's voice is its model and xAI has none, so neither has a model to pick. */}
          {!TTS_VOICE_ONLY.includes(ttsProvider) && (
            <PickField
              id="cfg-tts-m"
              label="TTS model"
              value={cfg.tts?.model || ""}
              options={ttsModels}
              placeholder="provider default"
              onChange={(v) => patch((c) => (c.tts = { ...c.tts, model: v }))}
            />
          )}
          <PickField
            id="cfg-tts-v"
            label="Voice"
            value={cfg.tts?.voice || ""}
            options={voices}
            placeholder={TTS_VOICE_HINTS[ttsProvider] ?? "aura-2-helena-en"}
            onChange={(v) => patch((c) => (c.tts = { ...c.tts, voice: v }))}
          />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <NumberField
            id="cfg-tts-speed"
            label="Voice speed"
            step="0.05"
            min={speedRange(ttsProvider).min}
            max={speedRange(ttsProvider).max}
            value={cfg.tts?.speed}
            placeholder="1.0"
            hint={speedHint(ttsProvider, cfg.tts?.speed)}
            onChange={(v) => patch((c) => (c.tts = withField(c.tts, "speed", v)))}
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
      </>)}

      {section === "tools" && (<>
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

        <h3>Built-in tools</h3>
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
        <h3>Tool server</h3>
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
          Custom tools are edited in <strong>Advanced (JSON)</strong>.
        </p>
      </>)}

      {section === "skills" && (
        <AgentSkills
          skills={Array.isArray(cfg.skills) ? cfg.skills : []}
          maxLoaded={typeof cfg.max_loaded_skills === "number" ? cfg.max_loaded_skills : undefined}
          isS2S={isS2S}
          editable={editable}
          errors={saveErrors ?? []}
          onSkills={(skills) =>
            patch((c) => {
              // TurnCall replaces the whole config on save, so no key is none.
              if (skills.length) c.skills = skills;
              else delete c.skills;
            })
          }
          onMaxLoaded={(v) => setCfg((c: any) => withField(c, "max_loaded_skills", v))}
        />
      )}

      {section === "turn-taking" && (<>
        <TurnTaking cfg={cfg} isS2S={isS2S} editable={editable}
          onSet={(key, v) => setCfg((c: any) => withField(c, key, v))} />
        <h3>Usage limits</h3>
        <Limits agentId={agentId} editable={editable} />
      </>)}

      {section === "guardrails" && (<>
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
      </>)}

      {section === "avatar" && (
        <Avatar value={cfg.avatar} editable={editable}
          onChange={(a) => setCfg((c: any) => withField(c, "avatar", a))} />
      )}

      {section === "advanced" && <AdvancedJson />}
    </section>
  );
}

// The whole config as JSON. Its text is its own state: a half-typed edit that
// does not parse yet leaves the draft as it was, and blocks Save until it does.
function AdvancedJson() {
  const { draft, setDraft, setJsonError } = useAgent();
  const [text, setText] = useState(() => JSON.stringify(draft, null, 2));
  const [error, setError] = useState("");
  // Leaving the section discards unparsed text, so it must stop blocking Save.
  useEffect(() => () => setJsonError(""), [setJsonError]);

  function onJson(next: string) {
    setText(next);
    try {
      setDraft(JSON.parse(next));
      setError("");
      setJsonError("");
    } catch (e) {
      const m = e instanceof Error ? e.message : "invalid JSON";
      setError(m);
      setJsonError(m);
    }
  }

  return (
    <>
      <textarea
        className="input code"
        style={{ minHeight: "60vh" }}
        aria-label="Agent configuration JSON"
        value={text}
        onChange={(e) => onJson(e.target.value)}
      />
      {error && <p className="error-text">Invalid JSON: {error}</p>}
    </>
  );
}

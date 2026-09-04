import { useEffect, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { canEdit } from "../../roles";
import { useAgent } from "./AgentPage";

type Providers = { stt: string[]; llm: string[]; tts: string[]; s2s: string[] };
const FALLBACK_PROVIDERS: Providers = {
  stt: ["deepgram", "openai", "elevenlabs", "cartesia"],
  llm: ["openai", "anthropic", "openrouter", "ollama", "custom_openai"],
  tts: ["deepgram", "openai", "elevenlabs", "cartesia"],
  s2s: ["openai", "google"],
};

const STATUS_HINTS: Record<string, string> = {
  degraded: "running, but event/tool verification is unconfigured (webhook registration failed) — the backend rejects unsigned traffic, so no events will appear",
  failed: "the backend container failed to start — press Save to retry generation (root cause is in the builder API logs: make docker-logs)",
  stopped: "the backend container is not running — calls to this agent's tools and events will fail until it's started",
};

const BUILTIN_TOOLS = ["end_call", "transfer_call", "send_dtmf"];

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
  const [providers, setProviders] = useState<Providers>(FALLBACK_PROVIDERS);
  const [sttModels, setSttModels] = useState<string[]>([]); // live, for the selected STT provider
  const [models, setModels] = useState<string[]>([]); // live, for the selected LLM provider
  const [voices, setVoices] = useState<Opt[]>([]); // live, for the selected TTS provider
  const [s2sModels, setS2sModels] = useState<string[]>([]); // live, for the selected S2S provider
  const [s2sVoices, setS2sVoices] = useState<Opt[]>([]);

  useEffect(() => {
    api("/providers").then((r) => setProviders(r.data)).catch(() => {});
  }, []);

  const isS2S = (cfg.pipeline_mode || "cascade") === "s2s";

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
    try {
      const r = await api(`/agents/${agentId}`, { method: "PUT", body: JSON.stringify({ config: cfg }) });
      updateConfig(cfg);
      setMsg(
        r.data?.backend_regenerated
          ? "Saved — backend regenerated (tools changed); previous handler code is in git history."
          : "Saved."
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const tools: string[] = Array.isArray(cfg.tools) ? cfg.tools : [];
  const customCount = (cfg.custom_tools || []).length;
  const topics: string[] = cfg.guardrails?.prohibited_topics || [];

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
            <p className="muted" style={{ fontSize: 12.5, margin: "2px 0 0" }}>
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
          {jsonError && <p className="error-text" style={{ fontSize: 12.5 }}>Invalid JSON: {jsonError}</p>}
        </>
      ) : (
        <div style={{ flex: 1, overflowY: "auto" }}>
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
            <div style={{ display: "flex", gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="cfg-s2s-p">S2S provider</label>
                <select
                  id="cfg-s2s-p"
                  className="input"
                  value={cfg.s2s?.provider || "openai"}
                  onChange={(e) => patch((c) => (c.s2s = { ...c.s2s, provider: e.target.value }))}
                >
                  {providers.s2s.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <PickField
                id="cfg-s2s-m"
                label="S2S model"
                value={cfg.s2s?.model || ""}
                options={s2sModels}
                placeholder="gpt-4o-realtime-preview"
                onChange={(v) => patch((c) => (c.s2s = { ...c.s2s, model: v }))}
              />
              <PickField
                id="cfg-s2s-v"
                label="Voice"
                value={cfg.s2s?.voice || ""}
                options={s2sVoices}
                placeholder="alloy"
                onChange={(v) => patch((c) => (c.s2s = { ...c.s2s, voice: v }))}
              />
            </div>
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
                {providers.stt.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
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
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="cfg-llm-p">LLM provider</label>
              <select
                id="cfg-llm-p"
                className="input"
                value={cfg.llm?.provider || "openai"}
                onChange={(e) => patch((c) => (c.llm = { ...c.llm, provider: e.target.value }))}
              >
                {providers.llm.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <PickField
              id="cfg-llm-m"
              label="Model"
              value={cfg.llm?.model || ""}
              options={models}
              placeholder="gpt-4o-mini"
              onChange={(v) => patch((c) => (c.llm = { ...c.llm, model: v }))}
            />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="cfg-tts-p">TTS provider</label>
              <select
                id="cfg-tts-p"
                className="input"
                value={cfg.tts?.provider || "deepgram"}
                onChange={(e) => patch((c) => (c.tts = { ...c.tts, provider: e.target.value }))}
              >
                {providers.tts.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
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
          </>
          )}
          <fieldset style={{ border: 0, padding: 0, margin: "0 0 16px" }}>
            <legend style={{ padding: 0, fontWeight: 500, fontSize: 13 }}>Built-in tools</legend>
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
          </fieldset>
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
            <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
              Comma-separated — the agent refuses to discuss these.
            </p>
          </div>
          <div className="field">
            <label htmlFor="cfg-server-url">Tool server URL</label>
            <input
              id="cfg-server-url"
              className="input"
              value={cfg.server_url || ""}
              onChange={(e) => patch((c) => (c.server_url = e.target.value || null))}
              placeholder="https://your-server.example (blank = generated backend)"
            />
            <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
              Where the agent's custom tools POST. Leave blank to use the generated backend.
            </p>
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            {customCount > 0 ? `${customCount} custom tool${customCount > 1 ? "s" : ""}. ` : ""}
            Custom tools, speech-to-speech, voicemail, MCP, and analysis live in{" "}
            <strong>Advanced (JSON)</strong>.
          </p>
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
    </div>
  );
}

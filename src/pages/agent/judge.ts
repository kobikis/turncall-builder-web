// The model that decides an eval's verdicts (turncall#118/#119).
//
// An `eval:` assertion and every simulation are settled by a judge LLM, not by
// string matching. TurnCall exposes it as a typed block on the scenario —
// `{provider, model, temperature}` over a closed set of providers, because its
// own escape hatch is a dotted import path that must never come from a form.
//
// Two levels, and the Console has to be plain about which one is in force: the
// scenario's own block, or the platform default set by whoever runs TurnCall.
// A blank field that silently means "the default" is how the wrong judge runs
// for a month.

export type JudgeBlock = {
  provider?: string | null;
  model?: string | null;
  temperature?: number | null;
};

// Matches TurnCall's allowlist. Each name maps to a factory TurnCall ships;
// there is no "other", by design.
// `models` is a shortlist to pick from, not a closed set — the field stays
// typeable, because a provider ships a new model long before this list hears
// about it, and an Ollama model is whatever that box happens to serve. These
// are the ones TurnCall itself names: its per-provider defaults, and the house
// models its agent config already documents.
export const PROVIDERS = [
  {
    id: "ollama",
    label: "Ollama (local)",
    defaultModel: "the model your Ollama serves",
    models: [],
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-haiku-4-5-20251001",
    models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"],
  },
];

export const INHERIT = "";

const NAMES: Record<string, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/** A judge block as one line, or null when the scenario names none. */
export function judgeLabel(judge?: JudgeBlock | null): string | null {
  if (!judge || !judge.provider) return null;
  const parts = [NAMES[judge.provider] || judge.provider];
  if (judge.model) parts.push(judge.model);
  if (judge.temperature !== null && judge.temperature !== undefined)
    parts.push(`temperature ${judge.temperature}`);
  return parts.join(" · ");
}

// The models that reject a temperature outright — Claude, and OpenAI's
// reasoning families. TurnCall drops it rather than letting the provider end
// the run with a 400, so the form says so instead of accepting a number that
// goes nowhere. Same rule as the agent's own LLM config.
const REASONING = ["o1", "o3", "o4", "gpt-5"];

export function takesTemperature(provider: string, model: string): boolean {
  if (provider === "anthropic") return false;
  const name = (model || "").toLowerCase();
  return !REASONING.some((prefix) => name.startsWith(prefix));
}

/** What decided a run, read back from its harness snapshot. */
export function judgedBy(harness?: Record<string, unknown> | null): string | null {
  if (!harness) return null;
  // Pipecat fills its default judge in whether or not one is ever asked
  // anything, so a scenario of plain `text_contains` would otherwise report a
  // model that never ran. TurnCall records which of the two it was.
  if (harness.judge_used === false) return "No judge was asked — every expectation was checked directly";
  const provider = (harness.judge_provider || harness.judge_service) as string | undefined;
  if (!provider) return null;
  return judgeLabel({
    provider,
    model: harness.judge_model as string | null,
    temperature: harness.judge_temperature as number | null,
  });
}

/** The services an audio run put either side of the agent (turncall#72).
 *
 * A different TTS says the caller's line differently and a different STT
 * mishears the reply differently, so when an audio run fails where a text run
 * passed, this pair is usually the whole explanation. Null in text mode, where
 * neither is built.
 */
export function heardThrough(harness?: Record<string, unknown> | null): string | null {
  if (!harness) return null;
  const speech = harness.user_speech as { service?: string; voice?: string } | null;
  const stt = harness.bot_transcription as { service?: string } | null;
  if (!speech && !stt) return null;
  const said = speech ? [speech.service, speech.voice].filter(Boolean).join(" ") : "—";
  return `Caller spoken by ${said}, agent transcribed by ${stt?.service || "—"}`;
}

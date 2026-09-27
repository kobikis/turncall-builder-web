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
  // A classifier rather than an LLM (turncall#141): a verdict in a few hundred
  // milliseconds against several seconds, with a *calibrated* probability
  // rather than a model's own guess at how sure it is. Judge-only — TurnCall
  // keeps it out of the allowlist a persona is drawn from, because a persona is
  // linked into a pipeline to speak — so it must never appear in a simulator
  // picker if one is ever added here.
  //
  // `models` is empty for the reason Ollama's is, inverted: pipecat pins the
  // model (`jev-1.13.0`) so the thresholds tuned against it hold, and there is
  // no shortlist to offer. Needs TYPESAFE_API_KEY and the `evals-jev` extra on
  // the deployment; both are checked when a run builds the judge, never when a
  // scenario is saved, so this option stays selectable on a platform that has
  // not been provisioned yet.
  {
    id: "jev",
    label: "Jev (TypeSafe)",
    defaultModel: "jev-1.13.0",
    models: [],
  },
];

export const INHERIT = "";

const NAMES: Record<string, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
  jev: "Jev",
};

// The judge providers that are only a classifier, mirroring TurnCall's own
// `CLASSIFIER_ONLY_JUDGES`. Two things follow from it and nothing else does:
// there is no temperature to set, and there is no prose to read.
const CLASSIFIERS = ["jev"];

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
  // A classifier is not a sampler: there is no temperature to send, and
  // TurnCall drops one that is set. Offering the field would be the same
  // "accepting a number that goes nowhere" the Anthropic rule below avoids.
  if (provider === "anthropic" || CLASSIFIERS.includes(provider)) return false;
  const name = (model || "").toLowerCase();
  return !REASONING.some((prefix) => name.startsWith(prefix));
}

// Pipecat fills its default judge in whether or not one is ever asked anything,
// so a scenario of plain `text_contains` would otherwise report a model that
// never ran — the same lie as a policy that was never enforced. TurnCall
// records which of the two it was, and this is the sentence for it.
export const NOT_ASKED = "No judge was asked — every expectation was checked directly";

function judgeFromHarness(harness: Record<string, unknown>): string | null {
  const provider = (harness.judge_provider || harness.judge_service) as string | undefined;
  if (!provider) return null;
  return judgeLabel({
    provider,
    model: harness.judge_model as string | null,
    temperature: harness.judge_temperature as number | null,
  });
}

/** What decided a run, read back from its harness snapshot. For the details
 *  panel, which has a line to spend on saying why there is no model. */
export function judgedBy(harness?: Record<string, unknown> | null): string | null {
  if (!harness) return null;
  if (harness.judge_used === false) return NOT_ASKED;
  const judged = judgeFromHarness(harness);
  if (!judged) return null;
  const explained = explainedBy(harness);
  return explained ? `${judged} · ${explained}` : judged;
}

// A classifier decides but writes nothing, so a second model — the explainer —
// supplies the reason behind every `no` (turncall#139). Which one it was is on
// the snapshot, and it matters here for one reason: with no explainer
// configured, reasons are turned **off**, and a run full of bare probabilities
// reads as broken rather than as configured. This is the sentence that says
// which it is.
//
// Said only when it adds something. For an LLM judge the explainer is that same
// model, and repeating it in every row of the runs table would be noise.
function explainedBy(harness: Record<string, unknown>): string | null {
  if (harness.explainer_used === undefined) return null; // a run predating #139
  if (harness.explainer_used === false) return "no written reasons";
  const provider = harness.explainer_provider as string | undefined;
  if (!provider) return null;
  const judge = (harness.judge_provider || harness.judge_service) as string | undefined;
  const model = harness.explainer_model as string | undefined;
  if (provider === judge && model === (harness.judge_model as string | undefined)) return null;
  return `explained by ${[NAMES[provider] || provider, model].filter(Boolean).join(" ")}`;
}

/** The same answer for a column with room for a phrase: the sentence becomes
 *  two words, and everything else is unchanged. */
export function judgeOfRun(harness?: Record<string, unknown> | null): string | null {
  if (!harness) return null;
  if (harness.judge_used === false) return "Not asked";
  return judgeFromHarness(harness);
}

/** The model alone, for a narrow column — exactly as the Agent column beside
 *  it names the model under test. Provider and temperature go to the tooltip:
 *  "Anthropic · claude-haiku-4-5-20251001" does not fit the runs table, and
 *  wrapped every row of it in two.
 */
export function judgedByShort(harness?: Record<string, unknown> | null): string | null {
  if (!harness) return null;
  if (harness.judge_used === false) return "Not asked";
  return (harness.judge_model as string | undefined) || judgeFromHarness(harness);
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

/** What a scenario's Judge cell should say: the judge it names, or — failing
 *  that — the one its last run was actually decided by.
 *
 * "Platform default" on its own names no model, which is the thing a reader
 * wanted to know. The last run's snapshot holds the answer, so a scenario that
 * has run once can say `Ollama · gemma3` and mark it as inherited rather than
 * chosen. Before the first run there is genuinely nothing to report: the
 * default lives in TurnCall's environment, which the Console cannot read.
 */
export function effectiveJudge(
  judge: JudgeBlock | null | undefined,
  lastRunHarness?: Record<string, unknown> | null
): { label: string; source: "scenario" | "last-run" | "unknown" } {
  const own = judgeLabel(judge);
  if (own) return { label: own, source: "scenario" };
  const ran = judgeOfRun(lastRunHarness);
  if (ran) return { label: ran, source: "last-run" };
  return { label: "Platform default", source: "unknown" };
}

/** The model **under test** — the agent's own LLM, not the judge.
 *
 * A verdict is about a particular model answering a particular way, so a run
 * that does not say which one cannot be compared with the next any more than
 * one missing its judge can. It comes out of `resolved_config`, the snapshot
 * of the agent exactly as it ran — which is not the agent's config today, and
 * that difference is the point of snapshotting it.
 *
 * An S2S agent has no `llm:` block at all: the speech model *is* the LLM, so
 * the answer lives under `s2s`.
 */
export function agentModel(
  config?: Record<string, unknown> | null
): { short: string; full: string } | null {
  if (!config) return null;
  const s2s = config.pipeline_mode === "s2s";
  const block = (s2s ? config.s2s : config.llm) as {
    provider?: string;
    model?: string;
    temperature?: number | null;
  } | null;
  if (!block || !block.provider) return null;
  // Empty means the provider's own house model, which is a real answer and
  // not the same as "unknown" — TurnCall resolves it at pipeline build time.
  const model = block.model || "its default model";
  const parts = [NAMES[block.provider] || block.provider, model];
  if (block.temperature !== null && block.temperature !== undefined)
    parts.push(`temperature ${block.temperature}`);
  if (s2s) parts.push("speech-to-speech");
  return { short: model, full: parts.join(" · ") };
}

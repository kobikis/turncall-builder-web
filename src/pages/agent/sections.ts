// The Build view's section list, and what makes a section "edited".
//
// A section owns the top-level config keys its form writes. A key no section
// owns belongs to Advanced (JSON) — the only place it can be edited — so an
// unsaved change is always attributed somewhere, never lost from the count.
// Knowledge, Takeaways and Redaction and retention save through their own
// endpoints and own no keys.

type Cfg = Record<string, unknown>;

export type SectionId =
  | "setup" | "prompt" | "models" | "tools" | "capabilities" | "knowledge" | "takeaways"
  | "turn-taking" | "guardrails" | "compliance" | "avatar" | "advanced";

export const SECTIONS: { id: SectionId; title: string; keys?: string[] }[] = [
  { id: "setup", title: "Setup" },
  { id: "prompt", title: "Prompt", keys: ["system_prompt", "first_message"] },
  { id: "models", title: "Speech and models", keys: ["pipeline_mode", "stt", "llm", "tts", "s2s", "aws", "ambience"] },
  {
    id: "tools",
    title: "Tools and apps",
    keys: ["tools", "custom_tools", "integrations", "needs_integrations", "mcp_servers", "workspace_mcp_servers", "server_url"],
  },
  // The Workspace Capabilities this agent may load mid-call (builder-api #133).
  { id: "capabilities", title: "Capabilities", keys: ["skills", "max_loaded_skills"] },
  { id: "knowledge", title: "Knowledge" },
  { id: "takeaways", title: "Takeaways" },
  {
    id: "turn-taking",
    title: "Turn-taking and limits",
    keys: [
      "smart_turn_detection", "interruption_enabled", "greeting_interruptible", "smart_turn_stop_secs", "silence_timeout_ms",
      "user_idle_timeout_ms", "max_call_duration_seconds", "idle_message", "language",
    ],
  },
  { id: "guardrails", title: "Guardrails", keys: ["guardrails"] },
  // The agent's TurnCall project setting, saved on its own (like limits).
  { id: "compliance", title: "Redaction and retention" },
  { id: "avatar", title: "Video avatar", keys: ["avatar"] },
  { id: "advanced", title: "Advanced (JSON)" },
];

const OWNED = new Set(SECTIONS.flatMap((s) => s.keys ?? []));

// Key order is not a change: an edit that deletes and re-adds a key moves it.
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => same((a as Cfg)[k], (b as Cfg)[k]));
}

export function dirtySections(saved: unknown, draft: unknown): SectionId[] {
  const s = (saved ?? {}) as Cfg;
  const d = (draft ?? {}) as Cfg;
  const changed = [...new Set([...Object.keys(s), ...Object.keys(d)])].filter((k) => !same(s[k], d[k]));
  return SECTIONS.filter((sec) =>
    sec.keys ? sec.keys.some((k) => changed.includes(k)) : sec.id === "advanced" && changed.some((k) => !OWNED.has(k)),
  ).map((sec) => sec.id);
}

// The new agent's empty state (Option D's Setup card): what a working agent
// has that a fresh one does not yet.
export type SetupCheck = { label: string; done: boolean; fix: string; to: string };

export function setupChecks(
  agentId: string,
  cfg: Cfg,
  hasNumber: boolean,
  scenarios: number,
): SetupCheck[] {
  const base = `/agents/${agentId}`;
  const checks: SetupCheck[] = [
    { label: "Has a system prompt", done: Boolean(String(cfg.system_prompt ?? "").trim()), fix: "Write one", to: `${base}/build/prompt` },
    { label: "Answers on a phone number", done: hasNumber, fix: "Add a number", to: "/phone-numbers/new" },
    { label: "Has an eval scenario", done: scenarios > 0, fix: "Add one", to: `${base}/evals` },
  ];
  // TurnCall refuses failover on speech-to-speech, so it is not a step there.
  if ((cfg.pipeline_mode ?? "cascade") !== "s2s") {
    const backups = (cfg.llm as { failover?: unknown[] } | undefined)?.failover ?? [];
    checks.push({ label: "Has a backup model", done: backups.length > 0, fix: "Add failover", to: `${base}/build/models` });
  }
  return checks;
}

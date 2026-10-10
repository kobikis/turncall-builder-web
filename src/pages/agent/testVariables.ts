// The agent's {{placeholders}}, and the values a test fills them with. On a
// real call call-init supplies them; a test from the console has no call-init
// of its own, so it sends them itself (turncall#281 chat, #282 voice).

// TurnCall's own pattern: `{{name}}`, word characters only, no spaces.
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** Every placeholder the config uses — prompt, first message, tool
 *  descriptions — once each, in the order they first appear. */
export function placeholders(config: unknown): string[] {
  const text = JSON.stringify(config ?? {});
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/** What a test sends: the placeholders that have a value. An empty one is
 *  left out, so the agent sees `{{name}}` — the way it would on a call that
 *  did not set it. */
export function filled(names: string[], values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(names.filter((n) => values[n]?.trim()).map((n) => [n, values[n]]));
}

// Kept per agent in this browser, so a test does not start by retyping them.
const storageKey = (agentId: string) => `test-variables:${agentId}`;

export function loadValues(agentId: string): Record<string, string> {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(agentId)) || "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

export function saveValues(agentId: string, values: Record<string, string>): void {
  try {
    localStorage.setItem(storageKey(agentId), JSON.stringify(values));
  } catch {
    /* private window or blocked storage: the values just do not persist */
  }
}

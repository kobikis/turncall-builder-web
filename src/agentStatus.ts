// What an agent's status is called in the interface.
//
// The API's values describe a container: `running`, `stopped`, `degraded`,
// `generating`, `failed`. The person reading them does not operate a container
// — they operate a phone number that a caller dials — so the words here are
// about the line, not the process. An agent is `ready` when it can take a call
// and `offline` when it cannot.
//
// The raw value stays the CSS class, deliberately: the badge colours are keyed
// to it (`.badge.running`, `.badge.degraded`, …) and a rename here is a
// vocabulary change, not a visual one.

type Status = { label: string; title?: string };

// A `title` is for the states where the word alone leaves a question. The two
// that do are the ones an operator has to act on.
const STATUSES: Record<string, Status> = {
  running: { label: "ready", title: "Answering calls" },
  stopped: { label: "offline", title: "Not answering calls" },
  degraded: {
    label: "needs setup",
    title: "Answering calls, but webhook signing is not configured",
  },
  // Covers a first build and a restart alike. "Building" would be wrong for
  // half of those, and what the reader wants to know is the same either way:
  // it is on its way up.
  generating: { label: "starting", title: "Building and starting the backend" },
  failed: { label: "failed to start", title: "The backend did not come up" },
  deleted: { label: "deleted" },
};

/** The label and tooltip for a backend status.
 *
 * An unknown value is passed through untranslated rather than hidden behind a
 * guess: a status this build has never heard of is information, and inventing
 * a friendly name for it would be the one way to make it useless.
 */
export function agentStatus(status: string): Status {
  return STATUSES[status] ?? { label: status };
}

// The states in which a caller who dials the number gets an answer. `degraded`
// is one of them: it answers, it just is not verifying webhook signatures.
const ANSWERING = new Set(["running", "degraded"]);

/** Whether an agent in this state answers a call right now.
 *
 * The filter's split, and deliberately the only one: "ready" and "offline" is
 * the question an operator actually has, where a list of six container states
 * is the question the API has. `starting` counts as not answering, which is
 * true — it is on its way up, and a caller ringing it now hears nothing.
 */
export function answersCalls(status: string): boolean {
  return ANSWERING.has(status);
}

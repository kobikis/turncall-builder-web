import { useEffect, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { canEdit } from "../../roles";
import { usePoll } from "../../usePoll";
import ScenarioEditor from "./ScenarioEditor";
import { judgeLabel, judgedBy, type JudgeBlock } from "./judge";
import { useAgent } from "./AgentPage";

// The agent's eval scenarios, and what happened last time they ran
// (builder-api #41/#42, turncall#68). TurnCall owns every bit of the engine —
// scenarios, runs, batches, mocks, verdicts and the worker that executes them.
// This tab reads it back and starts runs; nothing eval-shaped is stored here.
//
// Two rules the UI has to respect, both load-bearing:
//
//   * `errored` is NOT `failed`. A failure is a claim about the agent; an error
//     means nobody could tell — a judge outage, a pipeline that died. Rendering
//     them alike teaches people to distrust the suite, so they get different
//     words and different colours.
//   * There is no score. A run reports passed/failed out of iterations, and a
//     scripted 1/1 and a simulation 7/10 are one representation read twice.

type Scenario = {
  id: string;
  name: string;
  kind: string;
  tags: string[];
  description: string | null;
  // Carried so editing needs no second fetch — the list already returns them.
  definition: Record<string, unknown>;
  tool_mocks?: Record<string, unknown>;
  // Absent means this scenario names no judge and takes the platform's
  // (turncall#119) — not the same statement as naming ollama.
  judge?: JudgeBlock | null;
};

type Run = {
  id: string;
  scenario_id: string | null;
  scenario_name: string;
  status: "queued" | "running" | "passed" | "failed" | "errored" | "cancelled";
  passed_count: number;
  failed_count: number;
  iterations: number;
  error: string | null;
  batch_id: string | null;
  queued_at?: string;
  completed_at?: string | null;
  results?: ResultEntry[];
  // Which judge decided this run, among other things. A verdict is not
  // comparable across time without it — a provider-side model update moves the
  // whole baseline silently.
  harness_config?: Record<string, unknown>;
  // Things the author needs to know that are not verdicts: a mock keyed to a
  // tool this run cannot call, a judge that changed since the last verdict.
  warnings?: { code: string; message: string }[];
};

type ResultEntry = {
  iteration: number;
  passed: boolean | null;
  error: string | null;
  transcript: { role: string; content: string; text?: string }[];
  failures: { turn_index?: number; event_name?: string; reason?: string; kind?: string; name?: string }[];
};

const TERMINAL = ["passed", "failed", "errored", "cancelled"];
const isTerminal = (s: string) => TERMINAL.includes(s);

// Wording matters more than colour here: "could not check" is the difference
// between a regression and an outage, and a reader should not have to know our
// palette to tell them apart.
const STATUS: Record<string, { label: string; cls: string; hint?: string }> = {
  queued: { label: "Queued", cls: "muted" },
  running: { label: "Running…", cls: "muted" },
  passed: { label: "Passed", cls: "ok" },
  failed: { label: "Failed", cls: "error-text" },
  errored: {
    label: "Could not check",
    cls: "warn",
    hint: "The run did not complete — a judge or provider was unreachable. This says nothing about the agent.",
  },
  cancelled: { label: "Cancelled", cls: "muted" },
};

// A run's age is half of what "last run: passed" means — green from ten minutes
// ago and green from before the last three deploys are different claims. Short
// form in the cell, full ISO in the tooltip, because a date nobody can hover is
// still ambiguous about the year.
function when(iso?: string | null) {
  if (!iso) return { short: "—", full: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { short: "—", full: iso };
  return { short: d.toLocaleString(), full: d.toISOString() };
}

function RunWhen({ run }: { run: Run }) {
  const t = when(run.completed_at || run.queued_at);
  return (
    <span className="muted" title={t.full} data-testid="run-when">
      {t.short}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] || { label: status, cls: "muted" };
  return (
    <span className={s.cls} title={s.hint} data-testid={`status-${status}`}>
      {s.label}
    </span>
  );
}

// A judge swap is the first thing to check when a green scenario turns red, and
// it is emphatically not a failure — so it reads as a note on the row, in the
// warning colour rather than the error one (turncall#119).
function JudgeChanged({ run }: { run: Run }) {
  const w = (run.warnings || []).find((x) => x.code === "judge_changed");
  if (!w) return null;
  return (
    <span className="chip warn" style={{ marginLeft: 6 }} title={w.message} data-testid="judge-changed">
      Judge changed
    </span>
  );
}

function RunRow({ run, onOpen }: { run: Run; onOpen: (r: Run) => void }) {
  return (
    <tr>
      <td>{run.scenario_name}</td>
      <td>
        <StatusBadge status={run.status} />
        <JudgeChanged run={run} />
      </td>
      <td className="muted">
        {isTerminal(run.status) && run.status !== "errored"
          ? `${run.passed_count}/${run.iterations}`
          : "—"}
      </td>
      <td>
        <RunWhen run={run} />
      </td>
      <td>
        <button className="btn btn-sm" onClick={() => onOpen(run)}>
          Details
        </button>
      </td>
    </tr>
  );
}

function RunDetail({ run, onClose }: { run: Run; onClose: () => void }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>
          {run.scenario_name} — <StatusBadge status={run.status} />
        </h3>
        <button className="btn btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      {judgedBy(run.harness_config) && (
        <p className="muted" style={{ margin: "6px 0 0" }} data-testid="judged-by">
          Judged by {judgedBy(run.harness_config)}
        </p>
      )}
      {(run.warnings || []).map((w) => (
        <p key={w.code} className="warn" style={{ margin: "6px 0 0" }}>
          {w.message}
        </p>
      ))}
      {run.error && (
        <p role="alert" className="error-text" style={{ marginTop: 8 }}>
          {run.error}
        </p>
      )}
      {(run.results || []).map((entry) => (
        <div key={entry.iteration} style={{ marginTop: 12 }}>
          <p className="muted" style={{ margin: "0 0 4px" }}>
            Iteration {entry.iteration}
            {entry.error
              ? " — could not check"
              : entry.passed === null
                ? " — no verdict"
                : entry.passed
                  ? " — passed"
                  : " — failed"}
          </p>
          {entry.transcript.map((turn, i) => (
            <div key={i} style={{ paddingLeft: 12 }}>
              <strong>{turn.role === "user" ? "Caller" : "Agent"}:</strong> {turn.content}
              {/* Audio runs carry both: what the judge heard, and what the
                  agent's model actually wrote. When an audio run fails where a
                  text run passed, that difference is the whole explanation. */}
              {turn.text && turn.text !== turn.content && (
                <span className="muted"> (model said: {turn.text})</span>
              )}
            </div>
          ))}
          {entry.failures.map((f, i) => (
            <p key={i} className="error-text" style={{ paddingLeft: 12, margin: "4px 0 0" }}>
              ✗ {f.event_name || f.name || f.kind}: {f.reason}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function EvalsTab() {
  const { agentId } = useAgent();
  const { activeWorkspace } = useAuth();
  const editable = canEdit(activeWorkspace?.role); // viewers read; running costs model time
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [open, setOpen] = useState<Run | null>(null);
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Which scenarios the next run covers. Ids, not indexes: the list reorders
  // when a scenario is edited, and a selection that silently shifts rows would
  // run something nobody picked.
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const loadScenarios = () =>
    api(`/agents/${agentId}/eval-scenarios`)
      .then((r) => setScenarios(r.data || []))
      .catch((e) => setError(e.message));

  const loadRuns = () =>
    api(`/agents/${agentId}/eval-runs`)
      .then((r) => setRuns(r.data || []))
      .catch((e) => setError(e.message));

  useEffect(() => {
    loadScenarios();
    loadRuns();
  }, [agentId]);

  // A worker executes runs, so results arrive after the request returns. Poll
  // while anything is in flight and stop when everything is terminal — a tab
  // that keeps hitting the API after the work is done is just noise.
  const inFlight = runs.some((r) => !isTerminal(r.status));
  usePoll(async () => {
    await loadRuns();
    if (open && !isTerminal(open.status)) {
      const fresh = await api(`/agents/${agentId}/eval-runs/${open.id}`).catch(() => null);
      if (fresh) setOpen(fresh.data);
    }
  }, 2000, inFlight);

  async function run(body: Record<string, unknown>) {
    setError("");
    setBusy(true);
    try {
      await api(`/agents/${agentId}/eval-runs`, { method: "POST", body: JSON.stringify(body) });
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // The checked scenarios, one request each. They do not share a batch id: a
  // fan-out is TurnCall's and needs a tag every scenario carries, and an ad-hoc
  // selection is not a tag. `GET /eval-runs/batches/{id}` still answers for a
  // tag run; a picked set is read row by row, which is what picking rows means.
  const runPicked = async () => {
    for (const s of scenarios || []) if (picked.has(s.id)) await run({ scenario_id: s.id });
  };

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const allPicked = (scenarios || []).length > 0 && picked.size === (scenarios || []).length;
  const toggleAll = () =>
    setPicked(allPicked ? new Set() : new Set((scenarios || []).map((s) => s.id)));

  const latestFor = (scenarioId: string) =>
    runs.find((r) => r.scenario_id === scenarioId);

  if (error && scenarios === null)
    return <p role="alert" className="error-text">{error}</p>;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Scenarios check that this agent still behaves — a fixed conversation with
        expectations, run against the real pipeline.{" "}
        <a href="https://github.com/kobikis/turncall/blob/main/docs/guides/evals.mdx" target="_blank" rel="noreferrer">
          How evals work
        </a>
      </p>

      {error && <p role="alert" className="error-text">{error}</p>}

      {editing && (
        <ScenarioEditor
          agentId={agentId}
          scenario={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadScenarios();
          }}
        />
      )}

      {scenarios !== null && scenarios.length === 0 && (
        <div className="card" style={{ padding: 16 }}>
          <p style={{ margin: 0 }}>No scenarios yet.</p>
          <p className="muted" style={{ marginBottom: 0 }}>
            The quickest way to get one: open a call on the Calls tab and save it
            as a scenario. Writing them from scratch is rarely worth it.
          </p>
        </div>
      )}

      {scenarios !== null && scenarios.length > 0 && (
        <>
          <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }} data-testid="judge-note">
            A judge model decides <code>eval:</code> expectations and simulation
            verdicts; <code>text_contains</code> is checked without one. Scenarios
            below show the judge they name, or the platform default they inherit —
            open one to change it. A hosted judge spends model time on every such
            expectation and every simulation turn scored.
          </p>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            {editable && (
              <button
                className="btn btn-primary"
                onClick={runPicked}
                disabled={busy || picked.size === 0}
                title={
                  picked.size === 0
                    ? "Tick the scenarios to run"
                    : `Run the ${picked.size} ticked scenario(s)`
                }
              >
                {busy ? "Starting…" : `Run selected (${picked.size})`}
              </button>
            )}
            {inFlight && <span className="muted">Runs in progress…</span>}
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>
                  {editable && (
                    <input
                      type="checkbox"
                      checked={allPicked}
                      onChange={toggleAll}
                      aria-label="Select every scenario"
                    />
                  )}
                </th>
                <th>Scenario</th>
                <th>Judge</th>
                <th>Last run</th>
                <th>Passed</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => {
                const last = latestFor(s.id);
                return (
                  <tr key={s.id}>
                    <td>
                      {editable && (
                        <input
                          type="checkbox"
                          checked={picked.has(s.id)}
                          onChange={() => toggle(s.id)}
                          aria-label={`Select ${s.name}`}
                        />
                      )}
                    </td>
                    <td>
                      {s.name}
                      {s.tags.map((t) => (
                        <span key={t} className="chip" style={{ marginLeft: 6 }}>{t}</span>
                      ))}
                    </td>
                    <td>
                      {judgeLabel(s.judge) ? (
                        <span title="Set on this scenario">{judgeLabel(s.judge)}</span>
                      ) : (
                        <span className="muted" title="Whatever this TurnCall is configured to judge with — a local Ollama unless EVAL_JUDGE_PROVIDER is set">
                          Platform default
                        </span>
                      )}
                    </td>
                    <td>{last ? <StatusBadge status={last.status} /> : <span className="muted">never</span>}</td>
                    <td className="muted">
                      {last && isTerminal(last.status) && last.status !== "errored"
                        ? `${last.passed_count}/${last.iterations}`
                        : "—"}
                    </td>
                    <td>{last ? <RunWhen run={last} /> : <span className="muted">—</span>}</td>
                    <td>
                      {last && (
                        <button className="btn btn-sm" onClick={() => setOpen(last)}>
                          Details
                        </button>
                      )}
                      {editable && (
                        <button
                          className="btn btn-sm"
                          style={{ marginLeft: 6 }}
                          onClick={() => setEditing(s)}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {open && <div style={{ marginTop: 16 }}><RunDetail run={open} onClose={() => setOpen(null)} /></div>}

      {runs.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>Recent runs</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Status</th>
                <th>Passed</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 20).map((r) => (
                <RunRow key={r.id} run={r} onOpen={setOpen} />
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

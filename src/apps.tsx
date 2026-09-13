// How a Connected app presents itself, in one place. Two pages show the same
// apps for different reasons — /integrations to authorize one, an agent's
// Configuration tab to choose when it runs — and they should not disagree about
// what Slack is called or what colour it is.

export type CatalogInput = {
  name: string;
  label: string;
  placeholder?: string;
  /** Chosen from a list the API fetches per connected account, not typed. */
  options?: boolean;
};

/** An Action the catalog says is worth running when a call ends. */
export type CatalogAction = {
  id: string;
  label: string;
  /** Which input the summary rides in. A fact about the Action — never asked. */
  summary_arg: string;
  inputs: CatalogInput[];
};

export type CatalogApp = {
  app: string;
  name: string;
  tools: string[];
  /** Absent on an older API; an app with none simply offers no Automation. */
  actions?: CatalogAction[];
};

// What each app is for, in a sentence. Deliberately Console copy rather than a
// field on /integrations/catalog: the API describes what an app can *do* (its
// pinned tools), and a line of prose for a card is presentation. An app with no
// entry falls back to naming its tools, which is never wrong, only drier.
const BLURBS: Record<string, string> = {
  slack_v2: "Post messages and look up channels or people in your Slack workspace.",
  google_calendar: "Read availability and create, update, or list calendar events.",
};

// Brand-ish accents so a card is recognisable at a glance.
const TINTS: Record<string, string> = {
  slack_v2: "#4a154b",
  google_calendar: "#3b6df6",
};

/**
 * A stable colour for an app.
 *
 * Unknown apps get one derived from the slug rather than a shared grey, so two
 * of them never look like the same app on a grid.
 */
export function tint(slug: string): string {
  if (TINTS[slug]) return TINTS[slug];
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash} 52% 42%)`;
}

/** One line saying what the app is for. */
export function describe(row: CatalogApp): string {
  if (BLURBS[row.app]) return BLURBS[row.app];
  if (row.tools.length === 0)
    return "No longer in the catalog — it can be disconnected, not attached.";
  return `Gives an agent ${row.tools.map((t) => shortTool(row.app, t)).join(", ")}.`;
}

/** A tool named without its app prefix, which is noise to a reader. */
export const shortTool = (app: string, tool: string) => tool.replace(`${app}-`, "");

/**
 * Whether this workspace can actually use the app right now.
 *
 * `lost` is not `disconnected`: it means an agent still has the app attached
 * while the grant behind it is gone, so the tools are advertised and answer
 * nothing. That is a fault to fix, not a neutral state to read past.
 */
export type AppStatus = "connected" | "disconnected" | "lost";

const STATUS: Record<AppStatus, string> = {
  connected: "Connected",
  disconnected: "Not connected",
  lost: "Disconnected",
};

/**
 * The card header: a lettered tile, the status on the right.
 *
 * The status lives here rather than in the footer because it is the first thing
 * someone scanning a grid is looking for, and a coloured dot answers it without
 * being read. "Unlisted" earns its own mark only when it applies — labelling
 * every app "TOOL" told a reader nothing they could not already see.
 */
export function AppHead({ row, status }: { row: CatalogApp; status?: AppStatus }) {
  return (
    <div className="head">
      <span className="app-tile" aria-hidden="true" style={{ background: tint(row.app) }}>
        {row.name.charAt(0).toUpperCase()}
      </span>
      {row.tools.length === 0 && <span className="kicker">Unlisted</span>}
      {status && <span className={`badge app-status ${status}`}>{STATUS[status]}</span>}
    </div>
  );
}

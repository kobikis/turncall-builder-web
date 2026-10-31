// What a procedure step's tool may be: the agent's own tools, the pinned tools
// of the Connected apps it uses during calls, and — when it has MCP servers —
// any name, since a server's tools are only discovered when a call starts.
import type { CatalogApp } from "../../../apps";
import { readAttachment, type AttachmentValue } from "../ConnectedApps";

export type ToolGroup = { label: string; names: string[] };

export type StepToolChoices = {
  groups: ToolGroup[];
  /** The agent has MCP servers: a name no group lists may be typed. */
  typed: boolean;
};

/** The picker's option for typing an MCP tool's name. */
export const OTHER_TOOL = "Another tool from an MCP server…";

const listed = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function stepToolChoices(cfg: Record<string, any>, catalog: CatalogApp[]): StepToolChoices {
  const own = [
    ...listed(cfg.custom_tools).map((t: any) => t?.name),
    ...listed(cfg.tools).filter((t) => typeof t === "string"),
  ].filter((n): n is string => typeof n === "string" && n !== "");
  const known = new Map(catalog.map((a) => [a.app, a]));
  // An app that only runs when a call ends puts no tool in front of the model.
  const apps = listed(cfg.integrations)
    .map((a) => readAttachment(a as AttachmentValue))
    .filter((a) => a.midCall)
    .map((a) => known.get(a.app))
    .filter((a): a is CatalogApp => Boolean(a && a.tools.length));
  return {
    groups: [
      ...(own.length ? [{ label: "Agent tools", names: own }] : []),
      ...apps.map((a) => ({ label: a.name, names: a.tools })),
    ],
    typed: listed(cfg.mcp_servers).length > 0 || listed(cfg.workspace_mcp_servers).length > 0,
  };
}

export const allNames = (choices: StepToolChoices): string[] => choices.groups.flatMap((g) => g.names);

// A skill version as the form edits it, and back to what TurnCall takes.
//
// A tool's parameters are a JSON schema typed as text, and its timeout a number
// typed as text: both are held as typed until saved, so a half-typed schema
// never throws the edit away. Converting them is where they are checked, and a
// bad one is refused on its own field before anything is sent.
import type { FieldError } from "../../api";
import type { SkillTool, SkillVersion } from "../../types";

export type ToolDraft = {
  name: string;
  description: string;
  webhook_url: string;
  timeout: string;
  params: string;
  /** Whatever else the tool carried (`max_retries`, a masked secret...), kept. */
  rest: Record<string, unknown>;
};

export type Draft = { name: string; description: string; instructions: string; tools: ToolDraft[] };

/** What a skill is sent as: create takes all of it, a draft edit all but the name. */
export type DraftBody = { name: string; description: string; instructions: string; tools: SkillTool[] };

export const NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;

const EMPTY_SCHEMA = '{\n  "type": "object",\n  "properties": {}\n}';

export const blankTool = (): ToolDraft => ({
  name: "",
  description: "",
  webhook_url: "",
  timeout: "",
  params: EMPTY_SCHEMA,
  rest: {},
});

export const blankDraft = (): Draft => ({ name: "", description: "", instructions: "", tools: [] });

export function toolDraft(tool: SkillTool): ToolDraft {
  const { name, description, webhook_url, timeout_seconds, parameters_schema, ...rest } = tool;
  return {
    name: name ?? "",
    description: description ?? "",
    webhook_url: webhook_url ?? "",
    timeout: timeout_seconds == null ? "" : String(timeout_seconds),
    params: parameters_schema ? JSON.stringify(parameters_schema, null, 2) : "",
    rest,
  };
}

export const fromVersion = (v: Pick<SkillVersion, "name" | "description" | "instructions" | "tools">): Draft => ({
  name: v.name,
  description: v.description ?? "",
  instructions: v.instructions ?? "",
  tools: (v.tools ?? []).map(toolDraft),
});

/** The draft as TurnCall takes it, or the fields that can't be sent as typed. */
export function toBody(d: Draft): { body: DraftBody } | { errors: FieldError[] } {
  const errors: FieldError[] = [];
  const tools = d.tools.map((t, i) => {
    const tool: SkillTool = { ...t.rest, name: t.name.trim(), description: t.description };
    if (t.webhook_url.trim()) tool.webhook_url = t.webhook_url.trim();
    if (t.timeout.trim()) {
      const n = Number(t.timeout);
      if (!Number.isFinite(n) || n <= 0)
        errors.push({ field: `tools[${i}].timeout_seconds`, message: "A timeout is a number of seconds above 0." });
      else tool.timeout_seconds = n;
    }
    if (t.params.trim()) {
      try {
        const schema = JSON.parse(t.params);
        if (typeof schema !== "object" || schema === null || Array.isArray(schema))
          errors.push({ field: `tools[${i}].parameters_schema`, message: "Parameters must be a JSON object (a JSON schema)." });
        else tool.parameters_schema = schema;
      } catch (e) {
        errors.push({
          field: `tools[${i}].parameters_schema`,
          message: `Not valid JSON: ${e instanceof Error ? e.message : "it does not parse"}`,
        });
      }
    }
    return tool;
  });
  if (errors.length) return { errors };
  return { body: { name: d.name.trim(), description: d.description, instructions: d.instructions, tools } };
}

export const sameDraft = (a: Draft | null, b: Draft | null): boolean => JSON.stringify(a) === JSON.stringify(b);

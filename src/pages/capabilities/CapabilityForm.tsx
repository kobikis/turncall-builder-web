// A Capability version's content: when to use it, its instructions and its
// tools. Editable for a draft and an editor; the same fields, disabled, show a
// published or archived version and a viewer what it says.
import type { ReactNode } from "react";
import type { FieldError } from "../../api";
import { blankTool, type Draft, type ToolDraft } from "./draft";
import { entryIndex, errorsAt } from "./fieldErrors";

// The tool fields the form has an input for; a refusal of any other part of a
// tool is shown on the tool as a whole.
const TOOL_FIELDS = ["name", "description", "webhook_url", "timeout_seconds", "parameters_schema"] as const;
type ToolField = (typeof TOOL_FIELDS)[number];

/** Whether the form shows this refused field somewhere. Anything it doesn't is
 *  the page's to show beside the form. */
export function placed(field: string, toolCount: number, withName: boolean): boolean {
  if (["description", "instructions", "tools"].includes(field)) return true;
  if (field === "name") return withName;
  const i = entryIndex(field, "tools");
  return i !== null && i < toolCount;
}

type Props = {
  value: Draft;
  /** Show the name input: only when creating; a version's name is fixed. */
  withName?: boolean;
  editable: boolean;
  errors: FieldError[];
  onChange: (next: Draft) => void;
};

function Problems({ id, messages }: { id: string; messages: string[] }) {
  if (!messages.length) return null;
  return (
    <div id={id}>
      {messages.map((m) => (
        <p key={m} className="error-text">{m}</p>
      ))}
    </div>
  );
}

function Field({ id, label, hint, messages, children }: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  messages: string[];
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="hint" style={{ margin: "4px 0 0" }}>{hint}</p>}
      <Problems id={`${id}-error`} messages={messages} />
    </div>
  );
}

const invalid = (messages: string[], id: string) =>
  messages.length ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};

export function CapabilityForm({ value, withName = false, editable, errors, onChange }: Props) {
  const set = (patch: Partial<Draft>) => onChange({ ...value, ...patch });
  const setTool = (i: number, patch: Partial<ToolDraft>) =>
    set({ tools: value.tools.map((t, n) => (n === i ? { ...t, ...patch } : t)) });

  const toolErrors = (i: number, field?: ToolField) =>
    field
      ? errorsAt(errors, `tools[${i}].${field}`)
      : errors
          .filter((e) => entryIndex(e.field, "tools") === i)
          .filter((e) => !TOOL_FIELDS.some((f) => e.field === `tools[${i}].${f}`))
          .map((e) => e.message);

  const nameErrs = errorsAt(errors, "name");
  const descErrs = errorsAt(errors, "description");
  const instrErrs = errorsAt(errors, "instructions");

  return (
    <>
      {withName && (
        <Field id="cap-name" label="Name" messages={nameErrs}
          hint="Lowercase letters, digits and underscores, up to 64. It can't be changed later; agents list it by this name.">
          <input id="cap-name" className="input" value={value.name} maxLength={64} disabled={!editable}
            placeholder="verify_caller" {...invalid(nameErrs, "cap-name")}
            onChange={(e) => set({ name: e.target.value })} />
        </Field>
      )}

      <Field id="cap-description" label="When to use it" messages={descErrs}
        hint="The one part the agent always sees. It loads the skill when this matches the conversation.">
        <textarea id="cap-description" className="input" rows={2} value={value.description} disabled={!editable}
          placeholder="Use when the caller asks about their account, before sharing anything about it."
          {...invalid(descErrs, "cap-description")}
          onChange={(e) => set({ description: e.target.value })} />
      </Field>

      <Field id="cap-instructions" label="Instructions" messages={instrErrs}
        hint="Added to the agent's prompt once it loads the skill.">
        <textarea id="cap-instructions" className="input" rows={8} value={value.instructions} disabled={!editable}
          placeholder={"Ask for the account number and the postcode on it.\nCall verify_account before saying anything about the account."}
          {...invalid(instrErrs, "cap-instructions")}
          onChange={(e) => set({ instructions: e.target.value })} />
      </Field>

      <h3>Tools</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Each tool POSTs to your own Tool server at its URL, and joins the agent's tools once the
        skill is loaded.
      </p>
      <Problems id="cap-tools-error" messages={errorsAt(errors, "tools")} />
      {value.tools.length === 0 && <p className="muted">No tools.</p>}
      {value.tools.map((tool, i) => {
        const n = i + 1;
        const id = (f: string) => `cap-tool-${i}-${f}`;
        const errs = (f: ToolField) => toolErrors(i, f);
        return (
          <fieldset key={i} aria-label={`Tool ${n}`}
            style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: "0 0 10px" }}>
            <legend className="hint">Tool {n}</legend>
            <Problems id={id("error")} messages={toolErrors(i)} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 12rem" }}>
                <Field id={id("name")} label="Name" messages={errs("name")}>
                  <input id={id("name")} aria-label={`Tool ${n} name`} className="input" value={tool.name}
                    disabled={!editable} placeholder="verify_account" {...invalid(errs("name"), id("name"))}
                    onChange={(e) => setTool(i, { name: e.target.value })} />
                </Field>
              </div>
              <div style={{ flex: "0 0 9rem" }}>
                <Field id={id("timeout")} label="Timeout (s)" messages={errs("timeout_seconds")}>
                  <input id={id("timeout")} aria-label={`Tool ${n} timeout`} className="input" type="number" min={1}
                    value={tool.timeout} disabled={!editable} placeholder="10"
                    {...invalid(errs("timeout_seconds"), id("timeout"))}
                    onChange={(e) => setTool(i, { timeout: e.target.value })} />
                </Field>
              </div>
            </div>
            <Field id={id("description")} label="Description" messages={errs("description")}>
              <input id={id("description")} aria-label={`Tool ${n} description`} className="input"
                value={tool.description} disabled={!editable} placeholder="Checks an account number against its postcode."
                {...invalid(errs("description"), id("description"))}
                onChange={(e) => setTool(i, { description: e.target.value })} />
            </Field>
            <Field id={id("url")} label="URL" messages={errs("webhook_url")}>
              <input id={id("url")} aria-label={`Tool ${n} URL`} className="input" value={tool.webhook_url}
                disabled={!editable} placeholder="https://tools.example.com/verify-account"
                {...invalid(errs("webhook_url"), id("url"))}
                onChange={(e) => setTool(i, { webhook_url: e.target.value })} />
            </Field>
            <Field id={id("params")} label="Parameters (JSON schema)" messages={errs("parameters_schema")}>
              <textarea id={id("params")} aria-label={`Tool ${n} parameters`} className="input code" rows={5}
                value={tool.params} disabled={!editable} {...invalid(errs("parameters_schema"), id("params"))}
                onChange={(e) => setTool(i, { params: e.target.value })} />
            </Field>
            {editable && (
              <button type="button" className="btn" aria-label={`Remove tool ${n}`}
                onClick={() => set({ tools: value.tools.filter((_, k) => k !== i) })}>
                Remove
              </button>
            )}
          </fieldset>
        );
      })}
      {editable && (
        <button type="button" className="btn" onClick={() => set({ tools: [...value.tools, blankTool()] })}>
          Add tool
        </button>
      )}
    </>
  );
}

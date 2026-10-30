// Where a refused field's message is shown. The builder API names each field
// TurnCall refused the way a form addresses it — `name`, `tools[1].webhook_url`,
// `skills[0]` — so a message lands on the input it is about.
import type { FieldError } from "../../api";

/** The messages for exactly this field. */
export const errorsAt = (errors: FieldError[], field: string): string[] =>
  errors.filter((e) => e.field === field).map((e) => e.message);

/** The messages for this field and anything inside it (`skills[1]` and
 *  `skills[1].version_id`). */
export const errorsUnder = (errors: FieldError[], field: string): string[] =>
  errors
    .filter((e) => e.field === field || e.field.startsWith(`${field}.`) || e.field.startsWith(`${field}[`))
    .map((e) => e.message);

/** The index an entry error names (`tools[2]...` -> 2), or null. */
export const entryIndex = (field: string, list: string): number | null => {
  const m = new RegExp(`^${list}\\[(\\d+)\\]`).exec(field);
  return m ? Number(m[1]) : null;
};

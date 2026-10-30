// A refused write, as a Capability page keeps it: the sentence, the fields it
// names (shown on those fields by the form), and whatever else the refusal
// carried (a delete's 409 names the agents using the Capability).
import { ApiError, type FieldError } from "../../api";
import { errMsg } from "../../errors";
import { placed } from "./CapabilityForm";

export type Failure = { message: string; errors: FieldError[]; reason?: string; body?: unknown };

export const failureOf = (e: unknown, fallback: string): Failure => ({
  message: errMsg(e, fallback),
  errors: e instanceof ApiError ? e.errors ?? [] : [],
  reason: e instanceof ApiError ? e.reason : undefined,
  body: e instanceof ApiError ? e.body : undefined,
});

/** The refusal's sentence ("Not saved." first when it refused fields), unless every field it names is marked on the form
 *  already; then only a pointer to them. */
export function FailureNote({ failure, toolCount, withName = false }: {
  failure: Failure;
  toolCount: number;
  withName?: boolean;
}) {
  const elsewhere = failure.errors.filter((e) => !placed(e.field, toolCount, withName));
  const allOnFields = failure.errors.length > 0 && elsewhere.length === 0;
  return (
    <div className="callout error" role="alert">
      {failure.errors.length > 0 && <><strong>Not saved.</strong>{" "}</>}
      {allOnFields ? "Fix the fields marked below." : failure.message}
      {elsewhere.length > 0 && (
        <ul style={{ margin: "6px 0 0" }}>
          {elsewhere.map((e) => (
            <li key={`${e.field}:${e.message}`}><code>{e.field}</code>: {e.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { errMsg } from "../errors";
import PhoneNumberForm, { PhoneInitial, PhoneNumberFormHandle } from "./PhoneNumberForm";
import type { PendingPurchase } from "../types";

export default function EditPhoneNumber() {
  const { id } = useParams();
  // ?bind: opened to bind an unassigned number (Buy's pending screen links here),
  // so it starts on Agent routing. Without it, an unassigned number keeps
  // Unassigned selected and can be edited without binding it. A pending number
  // follows the same rule (#106).
  const [params] = useSearchParams();
  const bind = params.has("bind");
  // "Bind it" switches the form to Agent routing in place, so nothing typed is
  // lost (#108); after that, the form is a bind form like ?bind's.
  const form = useRef<PhoneNumberFormHandle>(null);
  const [bindChosen, setBindChosen] = useState(false);
  const [initial, setInitial] = useState<(PhoneInitial & PendingPurchase & { telnyx_order_id?: string | null }) | null>(null);
  // The save's answer, once there is one. It matters when a bind succeeds but
  // the form stays up (a webhook warning or a new secret): builder-api clears
  // the pending mark on the first bind that succeeds, so the callout goes.
  const [saved, setSaved] = useState<PendingPurchase | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setSaved(null);
    api(`/phone-numbers/${id}`)
      .then((r) => setInitial(r.data))
      .catch((e) => setError(errMsg(e, "Could not load this number.")));
  }, [id]);

  // Bought, but Telnyx hadn't finished the order (#100).
  const pending = (saved ?? initial)?.purchase_status === "pending";

  if (error) return <p role="alert" className="error-text">{error}</p>;
  if (!initial) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Edit phone number</h2>
          <p>Same-project edits keep the phone id and signing secret stable.</p>
        </div>
      </div>
      {pending && (
        <div className="callout info" role="status" style={{ maxWidth: 460, marginBottom: 16 }}>
          <strong>Ordered, waiting on Telnyx</strong>
          <p>
            Telnyx is still completing the order for this number
            {initial.telnyx_order_id ? <> (order <code>{initial.telnyx_order_id}</code>)</> : null}. The
            builder can't ask Telnyx whether the order is done, so trying a bind is the check: until
            it finishes, a bind is refused and the number stays as it is. Telnyx usually finishes within
            minutes, unless the order is waiting on regulatory documents, in which case it can take days.
          </p>
          {!bind && !bindChosen && (
            <p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  form.current?.bind();
                  setBindChosen(true);
                }}
              >
                Bind it
              </button>
            </p>
          )}
        </div>
      )}
      <PhoneNumberForm
        ref={form}
        initial={initial}
        lockNumber
        bind={bind}
        pendingBind={pending}
        submitLabel={bind && !pending && initial.routing_type === "none" ? "Bind number" : "Save"}
        onSubmit={async (body) => {
          const r = await api(`/phone-numbers/${id}`, { method: "PUT", body: JSON.stringify(body) });
          setSaved(r?.data ?? {});
          return r;
        }}
      />
    </div>
  );
}

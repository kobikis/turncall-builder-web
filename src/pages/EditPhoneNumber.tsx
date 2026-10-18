import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import PhoneNumberForm, { PhoneInitial } from "./PhoneNumberForm";
import type { PendingPurchase } from "../types";

export default function EditPhoneNumber() {
  const { id } = useParams();
  // ?bind: opened to bind an unassigned number (Buy's pending screen links here),
  // so it starts on Agent routing. Without it, an unassigned number keeps
  // Unassigned selected and can be edited without binding it.
  const [params] = useSearchParams();
  const bind = params.has("bind");
  const [initial, setInitial] = useState<(PhoneInitial & PendingPurchase) | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/phone-numbers/${id}`)
      .then((r) => setInitial(r.data))
      .catch((e) => setError(e.message));
  }, [id]);

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
      {initial.purchase_status === "pending" && (
        // Bought, but Telnyx hasn't finished the order (builder-web #100).
        // The bind form stays: it works as soon as the order lands (#104).
        <div className="callout info" role="status" style={{ maxWidth: 460, marginBottom: 16 }}>
          <strong>Ordered, waiting on Telnyx</strong>
          <p>
            Telnyx is still completing the order for this number. It can be bound once the
            order finishes; until then a bind is refused.
          </p>
        </div>
      )}
      <PhoneNumberForm
        initial={initial}
        lockNumber
        bind={bind}
        submitLabel={bind && initial.routing_type === "none" ? "Bind number" : "Save"}
        onSubmit={(body) => api(`/phone-numbers/${id}`, { method: "PUT", body: JSON.stringify(body) })}
      />
    </div>
  );
}

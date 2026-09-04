import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import PhoneNumberForm, { PhoneInitial } from "./PhoneNumberForm";

export default function EditPhoneNumber() {
  const { id } = useParams();
  const [initial, setInitial] = useState<PhoneInitial | null>(null);
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
      <PhoneNumberForm
        initial={initial}
        lockNumber
        submitLabel="Save"
        onSubmit={(body) => api(`/phone-numbers/${id}`, { method: "PUT", body: JSON.stringify(body) })}
      />
    </div>
  );
}

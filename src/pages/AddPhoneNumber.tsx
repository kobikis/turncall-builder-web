import { api } from "../api";
import PhoneNumberForm from "./PhoneNumberForm";

export default function AddPhoneNumber() {
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Add phone number</h2>
          <p>Bind a Twilio number and choose how inbound calls route.</p>
        </div>
      </div>
      <PhoneNumberForm
        submitLabel="Bind number"
        onSubmit={(body) => api("/phone-numbers", { method: "POST", body: JSON.stringify(body) })}
      />
    </div>
  );
}

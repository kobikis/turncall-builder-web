import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { isAdmin } from "../roles";
import BuyPhoneNumber, { type BuyStage } from "./BuyPhoneNumber";
import PhoneNumberForm from "./PhoneNumberForm";

export default function AddPhoneNumber() {
  const { activeWorkspace } = useAuth();
  // Buying spends the workspace's money: admins only (builder-web #100).
  // Editors see the page exactly as before.
  const admin = isAdmin(activeWorkspace?.role);
  const [mode, setMode] = useState<"bind" | "buy">("bind");
  const buying = admin && mode === "buy";
  // Switching to Bind unmounts the buy flow, so the switch is locked while a
  // purchase is in flight and gone once a number is bought.
  const [stage, setStage] = useState<BuyStage>("choosing");
  const buyStage = buying ? stage : "choosing";

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Add phone number</h2>
          <p>
            {buying
              ? "Buy a new number on the workspace's Twilio or Telnyx account, then choose how inbound calls route."
              : "Bind a Twilio, Telnyx or Asterisk number and choose how inbound calls route."}
          </p>
        </div>
      </div>
      {admin && buyStage !== "bought" && (
        <div role="group" aria-label="Add number" className="seg" style={{ marginBottom: 16 }}>
          <button type="button" aria-pressed={mode === "bind"} disabled={buyStage === "buying"}
            onClick={() => setMode("bind")}>
            Bind a number you have
          </button>
          <button type="button" aria-pressed={mode === "buy"} disabled={buyStage === "buying"}
            onClick={() => setMode("buy")}>
            Buy a number
          </button>
        </div>
      )}
      {buying ? (
        <BuyPhoneNumber onStage={setStage} />
      ) : (
        <PhoneNumberForm
          submitLabel="Bind number"
          onSubmit={(body) => api("/phone-numbers", { method: "POST", body: JSON.stringify(body) })}
        />
      )}
    </div>
  );
}

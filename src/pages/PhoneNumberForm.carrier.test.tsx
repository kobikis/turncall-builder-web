// @vitest-environment jsdom
//
// Telnyx and Asterisk numbers beside Twilio's (#65, builder-api#73).
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api", () => ({
  api: vi.fn(async (path: string) => {
    if (path === "/agents") return { data: { agents: [{ agent_id: "a1", name: "Support" }] } };
    // A workspace Twilio account must not leak into a Telnyx bind.
    if (path === "/integrations/twilio") return { data: { connected: true, account_sid: "AC" + "c".repeat(32) } };
    return { data: [] };
  }),
  ApiError: class ApiError extends Error {},
}));

import PhoneNumberForm from "./PhoneNumberForm";

afterEach(cleanup);

function show(initial = {}, lockNumber = false) {
  const onSubmit = vi.fn(async (_body: Record<string, unknown>) => ({ data: {} }));
  render(
    <MemoryRouter>
      <PhoneNumberForm initial={initial} lockNumber={lockNumber} submitLabel="Save" onSubmit={onSubmit} />
    </MemoryRouter>,
  );
  return onSubmit;
}

const pick = (carrier: string) => fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: carrier } });

it.each(["telnyx", "asterisk"])("binds a %s number with only the number and its routing", async (carrier) => {
  const onSubmit = show();
  await waitFor(() => expect(screen.getByLabelText("Agent")).toBeDefined());
  pick(carrier);
  // Twilio's own fields are gone.
  for (const twilio of ["Twilio Phone Number SID", "Twilio Account SID", "Twilio Auth Token", "Enable SMS"]) {
    expect(screen.queryByLabelText(twilio)).toBeNull();
  }
  expect(screen.queryByText("Twilio account")).toBeNull();
  fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+14156021922" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  const body = onSubmit.mock.calls[0][0];
  expect(body).toMatchObject({ carrier, e164: "+14156021922", routing_type: "agent", agent_id: "a1", sms_enabled: false });
  expect(body).not.toHaveProperty("use_workspace_twilio");
  expect(body).not.toHaveProperty("twilio_account_sid");
});

it("a new number is Twilio unless another carrier is picked", async () => {
  show();
  expect((screen.getByLabelText("Carrier") as HTMLSelectElement).value).toBe("twilio");
});

it("an existing number's carrier is shown and cannot change", async () => {
  const onSubmit = show({ e164: "+14156021922", carrier: "telnyx", routing_type: "agent", agent_id: "a1" }, true);
  const carrier = screen.getByLabelText("Carrier") as HTMLSelectElement;
  expect(carrier.value).toBe("telnyx");
  expect(carrier.disabled).toBe(true);
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ carrier: "telnyx" });
});

// The words the console uses for an agent's state.
//
// Worth a test of its own because the mapping is the whole feature: the API
// describes a container and the interface describes a phone line, and the two
// vocabularies have to stay deliberately apart.

import { describe, expect, it } from "vitest";
import { agentStatus, answersCalls } from "./agentStatus";

describe("agentStatus", () => {
  it("says what the agent does, not what the container does", () => {
    expect(agentStatus("running").label).toBe("ready");
    expect(agentStatus("stopped").label).toBe("offline");
  });

  it("names the two states that need acting on", () => {
    // `degraded` on its own tells the reader nothing about what to do.
    expect(agentStatus("degraded").label).toBe("needs setup");
    expect(agentStatus("degraded").title).toMatch(/webhook signing/);
    expect(agentStatus("failed").label).toBe("failed to start");
  });

  it("covers a first build and a restart with one word", () => {
    expect(agentStatus("generating").label).toBe("starting");
  });

  it("passes an unknown status through untranslated", () => {
    // A status this build has never heard of is information. A friendly name
    // invented for it would be the one way to lose that.
    expect(agentStatus("quarantined")).toEqual({ label: "quarantined" });
  });

  it("leaves the raw value free to stay the CSS class", () => {
    // The badge colours key off the API's value, so the mapping must not be
    // the only place the status exists.
    expect(agentStatus("running").label).not.toBe("running");
  });
});

describe("answersCalls", () => {
  it("is true for the states where a caller gets an answer", () => {
    expect(answersCalls("running")).toBe(true);
    // Degraded answers the phone; it just is not verifying webhook signatures.
    expect(answersCalls("degraded")).toBe(true);
  });

  it("is false while the agent is on its way up", () => {
    // A caller ringing a starting agent hears nothing, so grouping it with
    // "ready" would put a lie in the filter.
    expect(answersCalls("generating")).toBe(false);
  });

  it("is false for every state that does not answer", () => {
    for (const status of ["stopped", "failed", "deleted", "quarantined"]) {
      expect(answersCalls(status)).toBe(false);
    }
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { stashPendingInvite, takePendingInvite } from "./pendingInvite";

afterEach(() => localStorage.clear());

describe("pendingInvite", () => {
  it("stashes then returns the path once", () => {
    stashPendingInvite("/invite?token=abc");
    expect(takePendingInvite()).toBe("/invite?token=abc");
  });

  it("clears after taking, so it resumes exactly once", () => {
    stashPendingInvite("/invite?token=abc");
    takePendingInvite();
    expect(takePendingInvite()).toBeNull();
  });

  it("returns null when nothing is stashed", () => {
    expect(takePendingInvite()).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { atLeast, canEdit, isAdmin } from "./roles";

describe("roles", () => {
  it("canEdit: editor and admin yes, viewer no", () => {
    expect(canEdit("admin")).toBe(true);
    expect(canEdit("editor")).toBe(true);
    expect(canEdit("viewer")).toBe(false);
  });

  it("isAdmin: only admin", () => {
    expect(isAdmin("admin")).toBe(true);
    expect(isAdmin("editor")).toBe(false);
    expect(isAdmin("viewer")).toBe(false);
  });

  it("undefined role (no active workspace) grants nothing", () => {
    expect(canEdit(undefined)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(atLeast(undefined, "viewer")).toBe(false);
  });
});

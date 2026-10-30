import { describe, expect, it } from "vitest";
import { dayRangeToQuery, isCompleteDay, parseDay, pointerLabel, resourceLabel, validDay } from "./auditFormat";

describe("pointerLabel", () => {
  it("reads a JSON Pointer as its field path, unescaping ~1 and ~0", () => {
    expect(pointerLabel("/config/llm/model")).toBe("config › llm › model");
    expect(pointerLabel("/headers/a~1b/c~0d/0")).toBe("headers › a/b › c~d › 0");
    expect(pointerLabel("")).toBe("(value)");
  });
});

describe("resourceLabel", () => {
  it("names the API's resource types, and reads an unknown one plainly", () => {
    expect(resourceLabel("mcp_server")).toBe("MCP server");
    expect(resourceLabel("api_key")).toBe("Api key");
  });

  it("calls an agent's skills Skills and the Builder's own guidance Builder skills", () => {
    expect(resourceLabel("skill")).toBe("Skill");
    expect(resourceLabel("skill_library")).toBe("Skill library");
    expect(resourceLabel("builder_skill")).toBe("Builder skill");
  });
});

describe("dayRangeToQuery", () => {
  it("turns an inclusive local day range into since (inclusive) and until (exclusive)", () => {
    expect(dayRangeToQuery("2026-10-30", "2026-10-31")).toEqual({
      since: new Date(2026, 9, 30).toISOString(),
      until: new Date(2026, 10, 1).toISOString(),
    });
    expect(dayRangeToQuery("", "")).toEqual({});
    expect(dayRangeToQuery("2026-10-30", "")).toEqual({ since: new Date(2026, 9, 30).toISOString() });
  });
});

describe("parseDay and dayRangeToQuery on what a URL may hold", () => {
  it("keeps years under 100 as themselves", () => {
    const d = parseDay("0099-03-04")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([99, 2, 4, 0]);
  });

  it("refuses what is not a whole, real day, and leaves that bound out", () => {
    for (const bad of ["abc", "2026-1", "2026-02-30", "2026-13-01", "20261-01-01", ""]) expect(parseDay(bad)).toBeNull();
    expect(validDay("abc")).toBe("");
    expect(validDay(null)).toBe("");
    expect(validDay("2026-10-17")).toBe("2026-10-17");
    expect(() => dayRangeToQuery("abc", "2026-1")).not.toThrow();
    expect(dayRangeToQuery("abc", "2026-1")).toEqual({});
  });

  it("counts a day still being typed as incomplete", () => {
    expect(isCompleteDay("")).toBe(true);
    expect(isCompleteDay("2026-10-17")).toBe(true);
    expect(isCompleteDay("0020-10-17")).toBe(false);
    expect(isCompleteDay("2026-1")).toBe(false);
  });
});

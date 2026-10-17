import { describe, expect, it } from "vitest";
import { dayRangeToQuery, pointerLabel, resourceLabel } from "./auditFormat";

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

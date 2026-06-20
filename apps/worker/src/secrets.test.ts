import { describe, expect, it } from "vitest";

import { resolveToken } from "./secrets.js";

describe("resolveToken", () => {
  it("reads the token from the referenced env var", () => {
    expect(resolveToken("MALUDB_TOKEN__ACME", { MALUDB_TOKEN__ACME: "malu_x" })).toBe("malu_x");
  });

  it("throws when the secret is missing", () => {
    expect(() => resolveToken("MALUDB_TOKEN__ACME", {})).toThrow(/MALUDB_TOKEN__ACME/);
  });
});

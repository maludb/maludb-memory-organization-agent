import { describe, expect, it } from "vitest";

import { JOB_TYPES } from "./job-types.js";

describe("job-contracts", () => {
  it("declares the seven canonical job types", () => {
    expect(JOB_TYPES).toHaveLength(7);
  });

  it("has no duplicate job-type names", () => {
    expect(new Set(JOB_TYPES).size).toBe(JOB_TYPES.length);
  });
});

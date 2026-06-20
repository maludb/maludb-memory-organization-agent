import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { migrate } from "./migrate.js";
import { migrations } from "./migrations/index.js";

describe("migrations", () => {
  it("have unique ids", () => {
    const ids = migrations.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("0001 creates the core tables", () => {
    const sql = migrations[0]!.sql;
    for (const table of ["policies", "tenants", "job_runs", "review_items", "cost_records", "watermarks"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });
});

function fakePool(appliedIds: string[]): { pool: Pool; queries: string[] } {
  const queries: string[] = [];
  const client = {
    query: async (text: string) => {
      queries.push(text);
      if (/SELECT id FROM schema_migrations/.test(text)) {
        return { rows: appliedIds.map((id) => ({ id })), rowCount: appliedIds.length };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  return { pool: { connect: async () => client } as unknown as Pool, queries };
}

describe("migrate()", () => {
  it("runs pending migrations in a transaction and records them", async () => {
    const { pool, queries } = fakePool([]);
    const ran = await migrate(pool);
    expect(ran).toEqual(["0001_init"]);
    expect(queries).toContain("BEGIN");
    expect(queries).toContain("COMMIT");
    expect(queries.some((q) => /CREATE TABLE IF NOT EXISTS tenants/.test(q))).toBe(true);
  });

  it("skips already-applied migrations", async () => {
    const { pool, queries } = fakePool(["0001_init"]);
    const ran = await migrate(pool);
    expect(ran).toEqual([]);
    expect(queries).not.toContain("BEGIN");
  });
});

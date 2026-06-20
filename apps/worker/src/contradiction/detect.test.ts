import type { Statement } from "@maludb-agent/maludb-client";
import { describe, expect, it } from "vitest";

import { findCandidateConflicts } from "./detect.js";

const stmt = (over: Partial<Statement>): Statement => ({
  id: 0,
  subject_kind: "subject",
  subject_id: 1,
  verb_id: 2,
  object_kind: "subject",
  object_id: 10,
  predicate_id: null,
  valid_from: null,
  valid_to: null,
  confidence: 1,
  provenance: "accepted",
  source_package_id: null,
  created_at: "2026-06-20T00:00:00.000Z",
  ...over,
});

describe("findCandidateConflicts", () => {
  it("flags same subject/verb/predicate with different objects", () => {
    const conflicts = findCandidateConflicts([
      stmt({ id: 1, object_id: 10 }),
      stmt({ id: 2, object_id: 20 }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.statements.map((s) => s.id)).toEqual([1, 2]);
  });

  it("does not flag identical objects", () => {
    expect(findCandidateConflicts([stmt({ id: 1, object_id: 10 }), stmt({ id: 2, object_id: 10 })])).toHaveLength(0);
  });

  it("ignores inactive (closed) statements", () => {
    const conflicts = findCandidateConflicts([
      stmt({ id: 1, object_id: 10 }),
      stmt({ id: 2, object_id: 20, valid_to: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("separates groups by verb/predicate", () => {
    const conflicts = findCandidateConflicts([
      stmt({ id: 1, verb_id: 2, object_id: 10 }),
      stmt({ id: 2, verb_id: 3, object_id: 20 }),
    ]);
    expect(conflicts).toHaveLength(0);
  });
});

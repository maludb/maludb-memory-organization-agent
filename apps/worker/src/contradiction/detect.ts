import type { Statement } from "@maludb-agent/maludb-client";

/** A set of active statements that share (subject, verb, predicate) but assert different objects. */
export interface ConflictGroup {
  subjectId: number;
  verbId: number;
  predicateId: number | null;
  statements: Statement[];
}

function isActive(s: Statement): boolean {
  return s.valid_to === null || s.valid_to === undefined;
}

function objectKey(s: Statement): string {
  return `${s.object_kind ?? ""}:${s.object_id ?? ""}`;
}

/**
 * Find candidate contradictions in a subject's statements (pure; unit-tested). A candidate
 * is a group of active statements with the same (subject, verb, predicate) but ≥2 distinct
 * objects — the structural shape of a possible contradiction. The model then judges whether
 * the values genuinely conflict (docs/worker-design.md §6).
 */
export function findCandidateConflicts(statements: Statement[]): ConflictGroup[] {
  const groups = new Map<string, Statement[]>();
  for (const s of statements) {
    if (!isActive(s)) continue;
    const key = `${s.subject_id}|${s.verb_id}|${s.predicate_id ?? ""}`;
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  const conflicts: ConflictGroup[] = [];
  for (const arr of groups.values()) {
    const distinctObjects = new Set(arr.map(objectKey));
    if (arr.length >= 2 && distinctObjects.size >= 2) {
      const first = arr[0]!;
      conflicts.push({
        subjectId: first.subject_id,
        verbId: first.verb_id,
        predicateId: first.predicate_id,
        statements: arr,
      });
    }
  }
  return conflicts;
}

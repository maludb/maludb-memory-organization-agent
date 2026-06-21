import type { Migration } from "./index.js";

/**
 * Record how a review item was resolved (CLAUDE.md rule 4: provenance + explainability):
 * who decided it, an optional human note, and the structured result of executing the
 * accepted action (e.g. the `consolidated_into_memory_id` MaluDB returned). Additive only.
 */
export const migration0002: Migration = {
  id: "0002_review_resolution",
  sql: /* sql */ `
ALTER TABLE review_items ADD COLUMN IF NOT EXISTS resolved_by       text;
ALTER TABLE review_items ADD COLUMN IF NOT EXISTS resolution_note   text;
ALTER TABLE review_items ADD COLUMN IF NOT EXISTS resolution_result jsonb;
`,
};

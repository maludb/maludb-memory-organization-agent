/**
 * Prioritization scoring — the formula from docs/policies.md §4. Pure and unit-tested;
 * sub-score derivation from API signals lives in the evaluator (kept separate so this
 * stays trivially testable). All sub-scores are expected in [0, 1].
 */

export interface ScoreComponents {
  staleness: number;
  retrievalFrequency: number;
  domain: number;
  lowConfidence: number;
  contradiction: number;
  modelVersionChange: number;
  recentFailurePenalty: number;
  lowValueDecay: number;
}

export type ScoreWeights = ScoreComponents;

/** Default weights (docs/policies.md §3.1); contradiction is weighted above the rest. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  staleness: 1,
  retrievalFrequency: 1,
  domain: 1,
  lowConfidence: 1,
  contradiction: 1.5,
  modelVersionChange: 0.75,
  recentFailurePenalty: 1,
  lowValueDecay: 1,
};

/**
 * Priority score: weighted additive contributions minus weighted penalties.
 *   score = Σ wᵢ·contributionᵢ − Σ wⱼ·penaltyⱼ
 */
export function priorityScore(c: ScoreComponents, w: ScoreWeights = DEFAULT_WEIGHTS): number {
  return (
    w.staleness * c.staleness +
    w.retrievalFrequency * c.retrievalFrequency +
    w.domain * c.domain +
    w.lowConfidence * c.lowConfidence +
    w.contradiction * c.contradiction +
    w.modelVersionChange * c.modelVersionChange -
    w.recentFailurePenalty * c.recentFailurePenalty -
    w.lowValueDecay * c.lowValueDecay
  );
}

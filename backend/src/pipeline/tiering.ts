import type { Candidate, CandidateMapped, Tier } from '../types';

export function tierForScore(score: number): Tier {
  if (score >= 70) return 'Tier 1';
  if (score >= 45) return 'Tier 2';
  return 'Tier 3';
}

/** Stage 8 of the pipeline. Pure function - no LLM call needed. */
export function tierCandidates(candidates: CandidateMapped[]): Candidate[] {
  return candidates.map((c) => ({
    ...c,
    tier: tierForScore(c.confidenceScore),
  }));
}

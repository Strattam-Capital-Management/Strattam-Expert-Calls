import type { Bucket, Candidate, CoverageGap, CoverageReport } from '../types';

/**
 * Stage 11 of the pipeline. Computes an overall 0-100 coverage score plus bucket-by-bucket
 * gaps. Deliberately does NOT force-fill a bucket with a weak candidate to hide a gap -
 * a bucket with zero or only low-confidence candidates is reported as a concrete, named gap
 * instead (e.g. "No sourcing expert identified for Supply Chain & Sourcing").
 */
export function computeCoverage(candidates: Candidate[], buckets: Bucket[]): CoverageReport {
  const gaps: CoverageGap[] = [];
  let bucketsCovered = 0;

  for (const bucket of buckets) {
    const inBucket = candidates.filter((c) => c.expertiseBucketId === bucket.id);
    const strongCandidates = inBucket.filter((c) => c.tier === 'Tier 1' || c.tier === 'Tier 2');

    if (inBucket.length === 0) {
      gaps.push({
        topic: bucket.name,
        bucketId: bucket.id,
        severity: 'high',
        note: `No candidates identified for "${bucket.name}". Consider a manual expert-network search or a broader archetype for this bucket.`,
      });
      continue;
    }

    if (strongCandidates.length === 0) {
      gaps.push({
        topic: bucket.name,
        bucketId: bucket.id,
        severity: 'medium',
        note: `Only lower-confidence (Tier 3) candidates found for "${bucket.name}" - no strong Tier 1/2 candidate identified.`,
      });
      continue;
    }

    bucketsCovered++;

    if (strongCandidates.length === 1) {
      gaps.push({
        topic: bucket.name,
        bucketId: bucket.id,
        severity: 'low',
        note: `Only one strong (Tier 1/2) candidate for "${bucket.name}" - consider sourcing a backup in case of scheduling or compliance issues.`,
      });
    }
  }

  const bucketsTotal = buckets.length;
  const overallScore = bucketsTotal === 0 ? 0 : Math.round((bucketsCovered / bucketsTotal) * 100);

  return { overallScore, bucketsCovered, bucketsTotal, gaps };
}

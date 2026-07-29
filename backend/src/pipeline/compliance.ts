import type { CandidateDraft, CompanyProfile } from '../types';

export interface ComplianceFilterResult {
  survivors: CandidateDraft[];
  hardRemovedCount: number;
  flaggedCompetitorCount: number;
}

function norm(s?: string): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * Stage 5 of the pipeline. HARD-REMOVES anyone who is a current employee or current board
 * member of the target company - they never appear in output, not even flagged, regardless of
 * whatever relationshipToTarget classification an earlier stage assigned them. This checks the
 * raw currentCompany field directly (not just the enum) as a safety net against
 * misclassification upstream.
 *
 * FLAGS but keeps current employees of named competitors, leaving them to human compliance
 * review (complianceNotes set accordingly).
 */
export function applyComplianceFilter(
  candidates: CandidateDraft[],
  companyName: string,
  companyProfile: CompanyProfile
): ComplianceFilterResult {
  const targetNorm = norm(companyName);
  const competitorNorms = new Set(companyProfile.competitors.map(norm));

  let hardRemovedCount = 0;
  let flaggedCompetitorCount = 0;
  const survivors: CandidateDraft[] = [];

  for (const c of candidates) {
    const currentCompanyNorm = norm(c.currentCompany);

    // HARD REMOVE: current employee/board member of the target. Never appears in output.
    if (currentCompanyNorm && currentCompanyNorm === targetNorm) {
      hardRemovedCount++;
      continue;
    }

    // FLAG but keep: current employee of a named competitor.
    if (currentCompanyNorm && competitorNorms.has(currentCompanyNorm)) {
      flaggedCompetitorCount++;
      survivors.push({
        ...c,
        relationshipToTarget: 'current_competitor_employee',
        complianceNotes: [
          c.complianceNotes,
          'Currently employed by a named competitor - flagged for human compliance review before outreach.',
        ]
          .filter(Boolean)
          .join(' '),
      });
      continue;
    }

    survivors.push(c);
  }

  return { survivors, hardRemovedCount, flaggedCompetitorCount };
}

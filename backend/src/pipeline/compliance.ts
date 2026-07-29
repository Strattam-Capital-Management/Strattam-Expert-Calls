import type { CandidateDraft, CompanyProfile } from '../types';
import { buildTargetAliasSet, buildAliasSet, matchesAlias } from '../util/companyName';

export interface ComplianceFilterResult {
  survivors: CandidateDraft[];
  hardRemovedCount: number;
  flaggedCompetitorCount: number;
}

/**
 * Stage 5 of the pipeline. HARD-REMOVES anyone who is a current employee or current board
 * member of the target company - they never appear in output, not even flagged, regardless of
 * whatever relationshipToTarget classification an earlier stage assigned them. This checks the
 * raw currentCompany field directly (not just the enum) as a safety net against
 * misclassification upstream.
 *
 * Company-name matching is fuzzy (see util/companyName.ts), not an exact string comparison -
 * real company names show up in multiple forms across public sources (e.g. "Floor & Decor" vs.
 * "Floor & Decor Holdings, Inc."), and an exact match would let a current employee slip through
 * on nothing more than a legal-suffix difference. The target-company alias set includes the
 * literal name the user typed, the company name Claude's research step settled on (which may
 * be the fuller/legal name), and the confirmed disambiguation hint, if any.
 *
 * FLAGS but keeps current employees of named competitors, leaving them to human compliance
 * review (complianceNotes set accordingly).
 */
export function applyComplianceFilter(
  candidates: CandidateDraft[],
  companyName: string,
  companyProfile: CompanyProfile,
  companyHint?: string
): ComplianceFilterResult {
  const targetAliases = buildTargetAliasSet(companyName, companyProfile.companyName, companyHint);
  const competitorAliases = buildAliasSet(companyProfile.competitors);

  let hardRemovedCount = 0;
  let flaggedCompetitorCount = 0;
  const survivors: CandidateDraft[] = [];

  for (const c of candidates) {
    // HARD REMOVE: current employee/board member of the target. Never appears in output.
    if (matchesAlias(c.currentCompany, targetAliases)) {
      hardRemovedCount++;
      continue;
    }

    // FLAG but keep: current employee of a named competitor.
    if (matchesAlias(c.currentCompany, competitorAliases)) {
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

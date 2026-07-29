import * as crypto from 'crypto';
import { firecrawlSearch } from '../clients/firecrawl';
import { callClaude, extractJson } from '../clients/anthropic';
import { WEB_CANDIDATE_EXTRACTION_SYSTEM_PROMPT } from '../prompts/webExtraction';
import type { Bucket, CandidateDraft, CompanyProfile, RelationshipToTarget } from '../types';
import type { CostTracker } from '../costTracker';

function newId(): string {
  return crypto.randomUUID();
}

function norm(s?: string): string {
  return (s ?? '').trim().toLowerCase();
}

const OUTSIDE_THE_BOX_QUERY_TEMPLATES = (industry: string) => [
  `independent consultant ${industry} industry advisory named expert`,
  `trade association executive director ${industry} named`,
  `industry analyst covering ${industry} named report author`,
];

/**
 * Stage 12 of the pipeline. Supplementary searches for adjacent expert types the archetype
 * logic wouldn't naturally surface: independent industry consultants, trade-association
 * executives, and industry analysts. These are marked outsideTheBox: true and go through the
 * same compliance/scoring/mapping/tiering stages as every other candidate.
 */
export async function findOutsideTheBoxCandidates(
  companyName: string,
  companyHint: string | undefined,
  profile: CompanyProfile,
  buckets: Bucket[],
  model: string,
  costTracker: CostTracker
): Promise<CandidateDraft[]> {
  const hintSuffix = companyHint ? ` (${companyHint})` : '';
  const industry = profile.industry || `${companyName}'s industry`;
  const fallbackBucketId = buckets[0]?.id ?? 'outside-the-box';

  const drafts: CandidateDraft[] = [];

  for (const query of OUTSIDE_THE_BOX_QUERY_TEMPLATES(industry)) {
    const searchResult = await firecrawlSearch({ query: `${query} ${companyName}${hintSuffix}`, limit: 8, costTracker });
    if (!searchResult.success || searchResult.results.length === 0) continue;

    const snippetText = searchResult.results
      .map((r) => `URL: ${r.url}\nTITLE: ${r.title ?? ''}\nSNIPPET: ${r.description ?? ''}`)
      .join('\n\n---\n\n')
      .slice(0, 20_000);

    const userMessage = `Target company: ${companyName}${hintSuffix}
Industry: ${industry}
This is a supplementary "outside the box" search for adjacent expert types (industry
consultants, trade-association executives, industry analysts) not covered by the standard
archetype list.

Web search snippets:

${snippetText}

Extract any explicitly-named individuals matching this description per the rules in your
system prompt. Return JSON only.`;

    let parsed: any;
    try {
      const result = await callClaude({
        model,
        system: WEB_CANDIDATE_EXTRACTION_SYSTEM_PROMPT,
        userMessage,
        maxTokens: 2500,
        stepName: 'outside-the-box-extraction',
        costTracker,
      });
      parsed = extractJson(result.text);
    } catch (err: any) {
      console.error(`[outsideTheBox] extraction failed for query "${query}": ${err?.message ?? err}`);
      continue;
    }

    const people: any[] = parsed.people ?? [];
    const targetNorm = norm(companyName);

    for (const person of people) {
      if (!person.name || !person.company || !person.title) continue;
      const status: 'current' | 'former' | 'unknown' = person.employmentStatus ?? 'unknown';
      const companyNorm = norm(person.company);

      // Same compliance safety net as peopleSearch.ts: never include an ambiguous current/
      // former case where the company is the target itself.
      if (companyNorm === targetNorm && status === 'unknown') continue;

      const relationshipToTarget: RelationshipToTarget = companyNorm === targetNorm ? 'former_employee' : 'other';

      drafts.push({
        id: newId(),
        name: person.name,
        currentCompany: status === 'current' ? person.company : undefined,
        currentTitle: status === 'current' ? person.title : undefined,
        formerCompany: status === 'former' ? person.company : undefined,
        formerTitle: status === 'former' ? person.title : undefined,
        relevantRole: person.role || person.title,
        relationshipToTarget,
        expertiseBucketId: fallbackBucketId,
        tenureNote: status === 'unknown' ? 'Current vs. former employment status unconfirmed from source text.' : undefined,
        linkedinUrl: undefined,
        biographySource: `${person.sourceLabel ?? 'Public web source'} (${person.sourceUrl ?? 'no URL captured'})`,
        outsideTheBox: true,
      });
    }
  }

  return drafts;
}

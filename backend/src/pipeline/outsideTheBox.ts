import * as crypto from 'crypto';
import { firecrawlSearch } from '../clients/firecrawl';
import { callClaude, extractJson } from '../clients/anthropic';
import { WEB_CANDIDATE_EXTRACTION_SYSTEM_PROMPT } from '../prompts/webExtraction';
import { buildTargetAliasSet, matchesAlias } from '../util/companyName';
import type { Bucket, CandidateDraft, CompanyProfile, RelationshipToTarget } from '../types';
import type { CostTracker } from '../costTracker';

function newId(): string {
  return crypto.randomUUID();
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
    // Fuzzy target-company match (see util/companyName.ts) - a plain string comparison here
    // previously let a current CEO/President of the target slip through as an unrelated
    // "other" candidate whenever the source text used a different legal form of the company's
    // name (e.g. "Floor & Decor" vs. "Floor & Decor Holdings, Inc."), because the exact-string
    // comparison simply never matched and the compliance filter had nothing to catch.
    const targetAliases = buildTargetAliasSet(companyName, profile.companyName, companyHint);

    for (const person of people) {
      if (!person.name || !person.company || !person.title) continue;
      const status: 'current' | 'former' | 'unknown' = person.employmentStatus ?? 'unknown';
      const isTarget = matchesAlias(person.company, targetAliases);

      // Same compliance safety net as peopleSearch.ts: never include an ambiguous current/
      // former case where the company is the target itself.
      if (isTarget && status === 'unknown') continue;

      let relationshipToTarget: RelationshipToTarget;
      let currentCompany: string | undefined;
      let currentTitle: string | undefined;
      let formerCompany: string | undefined;
      let formerTitle: string | undefined;

      if (isTarget) {
        if (status === 'current') {
          // Deliberately relationshipToTarget: 'other', NOT 'former_employee' - this person is
          // currently at the target. Setting currentCompany here (not formerCompany) is what
          // lets compliance.ts's hard-remove check actually catch them; getting this backwards
          // was the bug that let sitting executives of the target through as if they were
          // unrelated "other" candidates.
          relationshipToTarget = 'other';
          currentCompany = person.company;
          currentTitle = person.title;
        } else {
          relationshipToTarget = 'former_employee';
          formerCompany = person.company;
          formerTitle = person.title;
        }
      } else {
        relationshipToTarget = 'other';
        if (status === 'current') {
          currentCompany = person.company;
          currentTitle = person.title;
        } else {
          formerCompany = person.company;
          formerTitle = person.title;
        }
      }

      drafts.push({
        id: newId(),
        name: person.name,
        currentCompany,
        currentTitle,
        formerCompany,
        formerTitle,
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

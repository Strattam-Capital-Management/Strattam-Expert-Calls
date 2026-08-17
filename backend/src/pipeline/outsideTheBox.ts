import * as crypto from 'crypto';
import { firecrawlSearch } from '../clients/firecrawl';
import { callClaude, extractJson } from '../clients/anthropic';
import { WEB_CANDIDATE_EXTRACTION_SYSTEM_PROMPT } from '../prompts/webExtraction';
import { buildTargetAliasSet, matchesAlias } from '../util/companyName';
import { relationshipForUnaffiliatedCategory } from './categoryQueries';
import type { ArchetypeCategory, Bucket, CandidateDraft, CompanyProfile, RelationshipToTarget } from '../types';
import type { CostTracker } from '../costTracker';

function newId(): string {
  return crypto.randomUUID();
}

// NOTE: consultant/trade_association/industry_analyst are now also first-class archetype
// categories generated per-company in buckets.ts (see prompts/bucketsArchetypes.ts), with
// tailored queries in categoryQueries.ts. This module is a supplementary, fixed-template sweep
// that runs regardless of what the archetype-generation step happened to propose for THIS
// company - a safety net for the case where Claude's archetype list under-indexed on one of
// these categories. Overlap with the archetype-driven results is expected and harmless -
// dedupeCandidates() in peopleSearch.ts's sourceCandidates() collapses duplicates by name+company.
const OUTSIDE_THE_BOX_QUERY_TEMPLATES: Array<{ category: ArchetypeCategory; buildQuery: (industry: string) => string }> = [
  { category: 'consultant', buildQuery: (industry) => `independent consultant ${industry} industry advisory named expert` },
  { category: 'trade_association', buildQuery: (industry) => `trade association executive director ${industry} named` },
  { category: 'industry_analyst', buildQuery: (industry) => `industry analyst covering ${industry} named report author` },
];

/**
 * Stage 12 of the pipeline. Supplementary searches for adjacent expert types that a given run's
 * archetype list might have under-covered: independent industry consultants, trade-association
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

  for (const template of OUTSIDE_THE_BOX_QUERY_TEMPLATES) {
    const query = template.buildQuery(industry);
    // Same fix as peopleSearch.ts: scrape real page content for the top hits rather than
    // relying on the bare search-result snippet, which very often doesn't contain the named
    // individual even when the linked article does. limit drops 8 -> 5 to offset the added
    // per-call cost of scraping.
    const searchResult = await firecrawlSearch({
      query: `${query} ${companyName}${hintSuffix}`,
      limit: 5,
      scrapeTopHits: true,
      costTracker,
    });
    if (!searchResult.success || searchResult.results.length === 0) continue;

    const snippetText = searchResult.results
      .map((r) => {
        const body = r.markdown ? r.markdown.slice(0, 4000) : r.description ?? '';
        return `URL: ${r.url}\nTITLE: ${r.title ?? ''}\nCONTENT: ${body}`;
      })
      .join('\n\n---\n\n')
      .slice(0, 24_000);

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
        maxTokens: 4000,
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
          // Deliberately NOT 'former_employee' - this person is currently at the target.
          // Setting currentCompany here (not formerCompany) is what lets compliance.ts's
          // hard-remove check actually catch them; getting this backwards was the bug that let
          // sitting executives of the target through as if they were unrelated candidates.
          relationshipToTarget = 'other';
          currentCompany = person.company;
          currentTitle = person.title;
        } else {
          relationshipToTarget = 'former_employee';
          formerCompany = person.company;
          formerTitle = person.title;
        }
      } else {
        // Not the target - tag with what this template was actually looking for (consultant/
        // trade_association_exec/industry_analyst) instead of the generic 'other' every one of
        // these candidates used to get lumped into.
        relationshipToTarget = relationshipForUnaffiliatedCategory(template.category);
        if (status === 'current') {
          currentCompany = person.company;
          currentTitle = person.title;
        } else {
          formerCompany = person.company;
          formerTitle = person.title;
        }
      }

      // Same fix as peopleSearch.ts - prefer the real, source-grounded background detail over
      // the generic disclaimer, since this is what scoring/questionMapping read to write a
      // specific reason for inclusion rather than generic filler.
      const background = typeof person.background === 'string' ? person.background.trim() : '';
      const tenureNote =
        background || (status === 'unknown' ? 'Current vs. former employment status unconfirmed from source text.' : undefined);

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
        tenureNote,
        linkedinUrl: undefined,
        biographySource: `${person.sourceLabel ?? 'Public web source'} (${person.sourceUrl ?? 'no URL captured'})`,
        outsideTheBox: true,
      });
    }
  }

  return drafts;
}

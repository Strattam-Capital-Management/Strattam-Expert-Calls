import type { ArchetypeCategory } from '../types';

/**
 * Per-archetype-category search plan. This is the piece that actually delivers the GLG-style
 * breadth the archetype taxonomy in types.ts/prompts/bucketsArchetypes.ts promises: each
 * category gets a query template tailored to where that TYPE of person is actually findable
 * (a Gartner analyst shows up in press quotes, a G2 reviewer shows up on g2.com, a former
 * target employee shows up in a press release naming their old title) rather than one generic
 * "named executive OR press release OR conference bio" query for every archetype regardless of
 * category, which is what this file replaces.
 *
 * `useCse: true` means the query is also worth running through Google Custom Search (see
 * clients/googleCse.ts) with `site:`-style scoping, in addition to Firecrawl's general web
 * search - useful specifically for the categories where a handful of known domains
 * (g2.com/capterra.com/trustradius.com, gartner.com/forrester.com/idc.com, .edu,
 * linkedin.com/in search-result snippets) are disproportionately likely to have the answer.
 */
export interface CategoryQuery {
  query: string;
  useCse: boolean;
}

/** Only these categories represent "did this person ever work at a specific named company" -
 * exactly the question PDL's structured person-search is built to answer. The rest (analysts,
 * academics, consultants, trade-association execs, conference speakers, product reviewers) are
 * fundamentally "find a named person matching a role/description on the open web," where PDL's
 * company-history search has nothing to query against and would just waste API calls/credits. */
export function isPdlEligible(category: ArchetypeCategory): boolean {
  return (
    category === 'target_employee' ||
    category === 'competitor_employee' ||
    category === 'customer' ||
    category === 'supplier'
  );
}

export function buildWebQueries(
  category: ArchetypeCategory,
  archetypeTitle: string,
  companyName: string,
  hintSuffix: string,
  industry: string
): CategoryQuery[] {
  switch (category) {
    case 'target_employee':
    case 'competitor_employee':
    case 'customer':
    case 'supplier':
      // The original default template - company-anchored, works well when the archetype is
      // tied to a specific named company (the target itself, or one of its competitors/
      // suppliers/customers from the CompanyProfile).
      return [
        {
          query: `"${archetypeTitle}" ${companyName}${hintSuffix} named executive OR press release OR conference bio`,
          useCse: false,
        },
        {
          query: `"${archetypeTitle}" ${companyName}${hintSuffix} named`,
          useCse: true, // catches LinkedIn search-result snippets Firecrawl's index may miss
        },
      ];

    case 'channel_partner':
      return [
        {
          query: `"${archetypeTitle}" (certified partner OR reseller OR "systems integrator" OR "channel partner") ${companyName}${hintSuffix} named`,
          useCse: false,
        },
        {
          query: `${industry} (VAR OR reseller OR "implementation partner" OR "solutions partner") named partner directory`,
          useCse: false,
        },
      ];

    // Industry-anchored categories (industry_analyst, academic, consultant, trade_association,
    // conference_speaker) are deliberately given MULTIPLE distinct query angles each, not one -
    // these are exactly the categories that don't depend on the target company's own public
    // footprint at all, so a small/obscure target shouldn't mean a thin result here. A "huge
    // industry, small company" target should still surface plenty of these candidates even when
    // the target-employee/competitor/customer/supplier categories come up nearly empty.
    case 'industry_analyst':
      return [
        {
          query: `"${archetypeTitle}" ${industry} analyst named quote OR report OR "Magic Quadrant" OR Wave`,
          useCse: false,
        },
        {
          query: `${industry} market research analyst named report author OR co-author`,
          useCse: false,
        },
        {
          query: `${industry} analyst named site:gartner.com OR site:forrester.com OR site:idc.com`,
          useCse: true,
        },
      ];

    case 'academic':
      return [
        {
          query: `"${archetypeTitle}" professor OR researcher ${industry} named university`,
          useCse: false,
        },
        {
          query: `${industry} academic research center director OR principal investigator named`,
          useCse: false,
        },
        {
          query: `${industry} professor research named site:edu`,
          useCse: true,
        },
      ];

    case 'consultant':
      return [
        {
          query: `independent consultant ${industry} advisory named expert "${archetypeTitle}"`,
          useCse: false,
        },
        {
          query: `${industry} consulting firm partner OR principal named boutique advisory`,
          useCse: false,
        },
        {
          query: `${industry} consultant named site:linkedin.com/in`,
          useCse: true,
        },
      ];

    case 'trade_association':
      return [
        {
          query: `trade association executive director OR board member ${industry} named`,
          useCse: false,
        },
        {
          query: `${industry} industry association president OR chairman named annual report`,
          useCse: false,
        },
      ];

    case 'conference_speaker':
      return [
        {
          query: `${industry} conference OR summit OR webinar speaker agenda named "${archetypeTitle}"`,
          useCse: false,
        },
        {
          query: `${industry} keynote OR panelist named 2024 OR 2025 conference agenda`,
          useCse: false,
        },
      ];

    case 'product_reviewer':
      return [
        {
          query: `"${companyName}"${hintSuffix} review named title company`,
          useCse: false,
        },
        {
          query: `${companyName} review site:g2.com OR site:capterra.com OR site:trustradius.com`,
          useCse: true,
        },
      ];

    default:
      return [
        {
          query: `"${archetypeTitle}" ${companyName}${hintSuffix} named executive OR press release OR conference bio`,
          useCse: false,
        },
      ];
  }
}

/** Maps an archetype category to the relationshipToTarget value a candidate should get when
 * none of the target/competitor/supplier/customer company-alias checks matched (i.e. this
 * person's value isn't "they worked at a specific named company" but "they're the kind of
 * unaffiliated expert this archetype category was searching for in the first place"). Without
 * this, every analyst/academic/consultant/trade-association/conference-speaker/reviewer
 * candidate silently collapsed into the generic 'other' bucket downstream, losing exactly the
 * signal that made them worth surfacing. */
export function relationshipForUnaffiliatedCategory(
  category: ArchetypeCategory
): 'channel_partner' | 'industry_analyst' | 'academic' | 'consultant' | 'trade_association_exec' | 'conference_speaker' | 'product_reviewer' | 'other' {
  switch (category) {
    case 'channel_partner':
      return 'channel_partner';
    case 'industry_analyst':
      return 'industry_analyst';
    case 'academic':
      return 'academic';
    case 'consultant':
      return 'consultant';
    case 'trade_association':
      return 'trade_association_exec';
    case 'conference_speaker':
      return 'conference_speaker';
    case 'product_reviewer':
      return 'product_reviewer';
    default:
      return 'other';
  }
}

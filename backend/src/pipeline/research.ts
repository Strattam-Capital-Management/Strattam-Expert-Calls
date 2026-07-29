import { firecrawlSearch } from '../clients/firecrawl';
import { callClaude, extractJson } from '../clients/anthropic';
import { grataEnrichCompany, GrataExecutiveContact } from '../clients/grata';
import { COMPANY_RESEARCH_SYSTEM_PROMPT } from '../prompts/companyResearch';
import { getCachedProfile, setCachedProfile } from '../db';
import { CONFIG } from '../config';
import type { CompanyProfile } from '../types';
import type { CostTracker } from '../costTracker';

export interface ResearchResult {
  profile: CompanyProfile;
  /** Only non-empty if GRATA_API_KEY is configured and the account's plan includes the
   * executive-contacts module - see peopleSearch.ts, which treats this as a third candidate
   * source alongside PDL and web research. */
  grataExecutives: GrataExecutiveContact[];
}

function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = n.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(n.trim());
  }
  return out;
}

function normalizeCacheKey(companyName: string, companyHint?: string): string {
  return `${companyName.trim().toLowerCase()}::${(companyHint ?? '').trim().toLowerCase()}`;
}

/**
 * Stage 1 of the pipeline. Gathers public info via Firecrawl search across several angles
 * (overview, revenue/customers, competitors, SEC/proxy filings, press, suppliers/distribution,
 * technology, leadership), then has Claude synthesize it into a structured CompanyProfile with
 * a sources[] citation for every material claim. If GRATA_API_KEY is configured, Grata's
 * structured similar-companies/enrichment data is layered on top to ground the
 * competitor/customer/supplier lists in real data instead of LLM inference alone (Grata data is
 * unioned with, not a replacement for, the Firecrawl+Claude synthesis - if Grata is unset or
 * errors, the profile is exactly as good as before it existed). Cached in SQLite keyed by
 * normalized (companyName + companyHint) for CACHE_TTL_DAYS so re-running the same company
 * doesn't re-spend Firecrawl/Grata credits.
 */
export async function researchCompany(
  companyName: string,
  companyHint: string | undefined,
  model: string,
  costTracker: CostTracker
): Promise<ResearchResult> {
  const cacheKey = normalizeCacheKey(companyName, companyHint);
  const cached = getCachedProfile(cacheKey, CONFIG.cacheTtlDays);
  if (cached) {
    return cached as ResearchResult;
  }

  const hintSuffix = companyHint ? ` (${companyHint})` : '';
  const queries = [
    `${companyName}${hintSuffix} company overview business model`,
    `${companyName}${hintSuffix} revenue drivers customers`,
    `${companyName}${hintSuffix} competitors market position`,
    `${companyName}${hintSuffix} SEC filing proxy statement 10-K`,
    `${companyName}${hintSuffix} press release news`,
    `${companyName}${hintSuffix} suppliers distribution channels`,
    `${companyName}${hintSuffix} technology stack product`,
    `${companyName}${hintSuffix} executives leadership conference`,
  ];

  const rawChunks: string[] = [];

  for (const query of queries) {
    const result = await firecrawlSearch({ query, limit: 8, costTracker });
    if (!result.success) continue;
    for (const r of result.results) {
      rawChunks.push(
        `SOURCE: ${r.title ?? '(untitled)'}\nURL: ${r.url}\n${r.description ?? ''}`.trim()
      );
    }
  }

  // Scrape a couple of top hits in full (e.g. the company's own site) - worth the latency cost
  // for just this one query, unlike blanket full-page scraping across every search.
  const homepageResult = await firecrawlSearch({
    query: `${companyName}${hintSuffix} official website`,
    limit: 3,
    scrapeTopHits: true,
    costTracker,
  });
  if (homepageResult.success) {
    for (const r of homepageResult.results) {
      rawChunks.push(
        `SOURCE (full page): ${r.title ?? '(untitled)'}\nURL: ${r.url}\n${r.markdown ?? r.description ?? ''}`.trim()
      );
    }
  }

  const rawText = rawChunks.join('\n\n---\n\n').slice(0, 60_000);

  const userMessage = `Target company: ${companyName}${hintSuffix}

Raw research material gathered from public web search (press, SEC filings, company site,
news):

${rawText || '(no material was found via search - return a sparse profile and note that in businessModel, do not fabricate content)'}

Synthesize a structured CompanyProfile JSON object per the schema in your system prompt.
Include a sources[] entry (label + url) for every material claim, drawn ONLY from the URLs
present above.`;

  const result = await callClaude({
    model,
    system: COMPANY_RESEARCH_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 4000,
    stepName: 'company-research-synthesis',
    costTracker,
  });

  const parsed = extractJson(result.text);
  const profile: CompanyProfile = {
    companyName: parsed.companyName ?? companyName,
    industry: parsed.industry ?? '',
    businessModel: parsed.businessModel ?? '',
    revenueDrivers: parsed.revenueDrivers ?? [],
    costStructure: parsed.costStructure ?? [],
    customers: parsed.customers ?? [],
    distributionChannels: parsed.distributionChannels ?? [],
    geographicFootprint: parsed.geographicFootprint ?? [],
    competitors: parsed.competitors ?? [],
    suppliers: parsed.suppliers ?? [],
    regulatoryConsiderations: parsed.regulatoryConsiderations ?? [],
    technologyStack: parsed.technologyStack ?? [],
    valueDrivers: parsed.valueDrivers ?? [],
    sources: parsed.sources ?? [],
  };

  // Ground competitors in Grata's structured similar-companies data, if configured. Unioned
  // (deduped) with whatever the LLM already inferred from scraped text, rather than replacing
  // it - Grata may miss niche/private competitors the web research surfaced, and vice versa.
  let grataExecutives: GrataExecutiveContact[] = [];
  if (CONFIG.grataApiKey) {
    const grata = await grataEnrichCompany(companyHint || companyName, costTracker);
    if (grata.success) {
      const similarNames = grata.similarCompanies
        .map((c) => c.name)
        .filter((n): n is string => Boolean(n));
      profile.competitors = dedupeNames([...profile.competitors, ...similarNames]);

      if (grata.company?.industry && !profile.industry) {
        profile.industry = grata.company.industry;
      }
      if (grata.company?.technologies?.length) {
        profile.technologyStack = dedupeNames([...profile.technologyStack, ...grata.company.technologies]);
      }
      if (similarNames.length > 0 || grata.company) {
        profile.sources = [
          ...profile.sources,
          { label: 'Grata - company enrichment & similar-companies search', url: 'https://grata.com' },
        ];
      }

      grataExecutives = grata.executives;
    }
  }

  const research: ResearchResult = { profile, grataExecutives };
  setCachedProfile(cacheKey, research);
  return research;
}

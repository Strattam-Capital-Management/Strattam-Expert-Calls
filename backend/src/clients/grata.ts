import { CONFIG } from '../config';
import type { CostTracker } from '../costTracker';

/**
 * Grata client - used two ways in the pipeline:
 *   1. research.ts: grounds competitor / similar-company / firmographic data in Grata's
 *      structured dataset instead of relying solely on LLM inference over scraped web text.
 *   2. peopleSearch.ts (optional): if the account's Grata plan includes the Data Warehouse /
 *      executive-contacts module, `executives` on the enrichment response becomes a third
 *      candidate source alongside PDL and web research.
 *
 * CONFIDENCE NOTE ON THIS FILE: Grata's account-scoped API reference (docs.grata.com) is a
 * Stoplight site that requires a logged-in session to render its full endpoint schemas - it
 * could not be fetched directly while writing this. What's implemented below is grounded in
 * Grata's own public marketing/API-overview pages (grata.com/api and public search-engine
 * snippets of their docs), which confirm:
 *   - the base host is `search.grata.com`
 *   - a versioned enrichment path exists at `/api/v1.2/enrich/`
 *   - Search and Similar-Companies are separate named endpoints in the same API family
 *   - auth requires an account to be activated for API access by a Grata CSM/AE first
 * What is NOT independently verified here: the exact Search/Similar-Companies path names,
 * the exact auth header format (Bearer vs. a custom key header - this defaults to Bearer,
 * the most common REST convention, with a single spot to change it if that's wrong), and the
 * exact field name(s) for executive/board contacts on the enrichment response (this defensively
 * checks a few plausible field names and simply finds nothing if none match, rather than
 * crashing). CONFIRM ALL OF THIS against your actual Grata API reference (visible once your
 * account is API-activated) before relying on it - treat this file as a strong first draft,
 * not a verified integration.
 */

const GRATA_BASE_URL = 'https://search.grata.com/api/v1.2';

export interface GrataCompany {
  name?: string;
  domain?: string;
  description?: string;
  industry?: string;
  employee_count?: number;
  employees?: number;
  hq_location?: string;
  technologies?: string[];
  ownership?: string;
  [key: string]: unknown;
}

export interface GrataExecutiveContact {
  full_name?: string;
  name?: string;
  title?: string;
  job_title?: string;
  is_current?: boolean;
  linkedin_url?: string;
  email?: string;
  [key: string]: unknown;
}

export interface GrataEnrichmentResult {
  success: boolean;
  company?: GrataCompany;
  similarCompanies: GrataCompany[];
  executives: GrataExecutiveContact[];
}

function authHeaders(): Record<string, string> {
  // Default: Bearer auth, the most common convention for this kind of REST API.
  // If your account's docs specify a different header (e.g. `X-API-Key`), change it here only -
  // every call in this file goes through this one function.
  return {
    Authorization: `Bearer ${CONFIG.grataApiKey}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Looks up a company by name/domain, requesting firmographic enrichment plus its most similar
 * companies (used as a structured competitor/comp-set signal). If the response happens to
 * include executive/board contact data (only present on plans with the Data Warehouse module),
 * that's extracted too - checked defensively against a few plausible field names since the
 * exact schema isn't independently verified (see file header).
 */
export async function grataEnrichCompany(
  companyNameOrDomain: string,
  costTracker?: CostTracker
): Promise<GrataEnrichmentResult> {
  const empty: GrataEnrichmentResult = { success: false, similarCompanies: [], executives: [] };

  if (!CONFIG.grataApiKey) {
    console.warn('[grata] GRATA_API_KEY not configured; skipping Grata enrichment');
    return empty;
  }

  try {
    if (costTracker) costTracker.addGrataCall();

    const res = await fetch(`${GRATA_BASE_URL}/enrich/`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ query: companyNameOrDomain }),
    });

    if (!res.ok) {
      console.error(`[grata] HTTP ${res.status} enriching "${companyNameOrDomain}" - continuing without Grata data`);
      return empty;
    }

    const json: any = await res.json();
    const company: GrataCompany | undefined = json.company ?? json.result ?? json;

    // Similar companies: some Grata responses nest this under `similar_companies` / `similar`;
    // request it as a second call to the (unverified-path) similar-search endpoint too, and
    // merge with anything already present on the enrichment payload.
    let similarCompanies: GrataCompany[] = json.similar_companies ?? json.similar ?? [];
    try {
      if (costTracker) costTracker.addGrataCall();
      const simRes = await fetch(`${GRATA_BASE_URL}/similar/`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ query: companyNameOrDomain, limit: 15 }),
      });
      if (simRes.ok) {
        const simJson: any = await simRes.json();
        const more: GrataCompany[] = simJson.companies ?? simJson.results ?? [];
        similarCompanies = [...similarCompanies, ...more];
      } else {
        console.warn(`[grata] similar-companies lookup returned HTTP ${simRes.status} - continuing with enrichment data only`);
      }
    } catch (err: any) {
      console.warn(`[grata] similar-companies lookup failed: ${err?.message ?? err} - continuing with enrichment data only`);
    }

    const executives: GrataExecutiveContact[] =
      (json.executives ?? json.key_contacts ?? json.contacts ?? company?.executives ?? []) as GrataExecutiveContact[];

    return { success: true, company, similarCompanies, executives };
  } catch (err: any) {
    console.error(`[grata] request failed for "${companyNameOrDomain}": ${err?.message ?? err} - continuing without Grata data`);
    return empty;
  }
}

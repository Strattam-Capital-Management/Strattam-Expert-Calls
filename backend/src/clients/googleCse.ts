import { CONFIG } from '../config';
import type { CostTracker } from '../costTracker';

export interface GoogleCseResult {
  title?: string;
  description?: string;
  url: string;
  // Always undefined - Google CSE never returns page content, only its own indexed snippet
  // (see the class-level comment above on why that's deliberate). This field exists purely so
  // callers that merge Firecrawl and CSE results into one array (see peopleSearch.ts) can treat
  // both shapes uniformly without a type-narrowing branch at every call site.
  markdown?: undefined;
}

export interface GoogleCseResponse {
  success: boolean;
  results: GoogleCseResult[];
}

const GOOGLE_CSE_URL = 'https://www.googleapis.com/customsearch/v1';

/**
 * Wraps Google's Custom Search JSON API (https://developers.google.com/custom-search/v1/overview).
 * This reads only Google's indexed search-result SNIPPETS (title/url/description) - it never
 * fetches or scrapes the linked page itself. That distinction matters specifically for queries
 * like `site:linkedin.com/in "VP Supply Chain" "Acme Corp"`: reading the snippet Google already
 * shows the public in ordinary search results is not the same thing as, and does not recreate,
 * the LinkedIn PROFILE scraping this codebase explicitly refuses to do elsewhere (see the NOTE
 * ON LINKEDIN / PROXYCURL comment in peopleSearch.ts) - we never visit or parse a linkedin.com
 * page's actual content here, only Google's own result metadata about it.
 *
 * Primary value-add over Firecrawl's general web search is `site:` scoping - cheaply targeting
 * specific domains (g2.com, capterra.com, trustradius.com, gartner.com, .edu, linkedin.com/in)
 * for the archetype categories where that's the highest-signal source (see
 * pipeline/categoryQueries.ts). No-op if GOOGLE_CSE_API_KEY / GOOGLE_CSE_CX aren't configured,
 * matching the graceful-degradation pattern used for every other optional source in this
 * codebase (Grata, Raylu).
 *
 * Google's free tier is 100 queries/day; above that it bills roughly $5 per 1,000 queries as of
 * this writing. CONFIG.googleCseCostPerCallUsd is a rough estimate constant for the cost
 * breakdown's sake only, not a contracted rate - verify against actual usage/billing before
 * relying on it for budgeting.
 */
export async function googleCseSearch(
  query: string,
  opts: { limit?: number; costTracker?: CostTracker } = {}
): Promise<GoogleCseResponse> {
  const { limit = 10, costTracker } = opts;

  if (!CONFIG.googleCseApiKey || !CONFIG.googleCseCx) {
    console.warn(`[googleCse] GOOGLE_CSE_API_KEY/GOOGLE_CSE_CX not configured; skipping search for query: "${query}"`);
    return { success: false, results: [] };
  }

  const url = new URL(GOOGLE_CSE_URL);
  url.searchParams.set('key', CONFIG.googleCseApiKey);
  url.searchParams.set('cx', CONFIG.googleCseCx);
  url.searchParams.set('q', query);
  // The CSE JSON API caps a single request at 10 results (num must be 1-10); pagination via
  // `start` isn't worth the extra call for this use case, where we're skimming for a handful of
  // named individuals per query, not exhaustively crawling results.
  url.searchParams.set('num', String(Math.min(Math.max(limit, 1), 10)));

  if (costTracker) costTracker.addGoogleCseCall();

  try {
    const res = await fetch(url.toString());

    if (!res.ok) {
      // Log the response body, not just the status - Google's 400/403 bodies name the exact
      // problem (bad key, CSE not enabled for this key, invalid cx, quota exceeded), which is
      // exactly the visibility gap that made the PDL "returns nothing" issue hard to diagnose.
      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch {
        // best-effort
      }
      console.error(`[googleCse] HTTP ${res.status} for query "${query}" - body: ${bodyText.slice(0, 500)}`);
      return { success: false, results: [] };
    }

    const json: any = await res.json();
    const items: any[] = json.items ?? [];
    const results: GoogleCseResult[] = items.map((it) => ({
      title: it.title,
      description: it.snippet,
      url: it.link,
    }));
    return { success: true, results };
  } catch (err: any) {
    console.error(`[googleCse] request failed for query "${query}": ${err?.message ?? err}`);
    return { success: false, results: [] };
  }
}

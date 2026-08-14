import { CONFIG } from '../config';
import type { CostTracker } from '../costTracker';

export interface FirecrawlSearchResult {
  title?: string;
  description?: string;
  url: string;
  markdown?: string;
}

export interface FirecrawlSearchResponse {
  success: boolean;
  results: FirecrawlSearchResult[];
  creditsUsed: number;
}

export interface FirecrawlSearchOpts {
  query: string;
  limit?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  /**
   * Only set this for the small number of top hits worth reading in full (e.g. the target's
   * own site/investor pages, or a specific promising bio/press page) - requesting full-page
   * markdown scraping for every search result is a major latency cost for little research
   * quality benefit.
   */
  scrapeTopHits?: boolean;
  costTracker?: CostTracker;
}

const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v2';

/**
 * Wraps Firecrawl's POST /search endpoint. Per the v2 API, the response's `data` field is an
 * OBJECT keyed by source type (web/images/news), not a flat array - we only ever request
 * `sources: [{type: "web"}]` and read `data.web`. Any non-200 response or `success: false` is
 * handled gracefully: log and return an empty result set so a single flaky search never
 * crashes a whole pipeline run - callers should simply get fewer sources / flag a gap.
 */
export async function firecrawlSearch(opts: FirecrawlSearchOpts): Promise<FirecrawlSearchResponse> {
  const { query, limit = 10, includeDomains, excludeDomains, scrapeTopHits, costTracker } = opts;

  if (!CONFIG.firecrawlApiKey) {
    console.warn(`[firecrawl] FIRECRAWL_API_KEY not configured; skipping search for query: "${query}"`);
    return { success: false, results: [], creditsUsed: 0 };
  }

  const body: Record<string, unknown> = {
    query,
    limit,
    sources: [{ type: 'web' }],
  };
  if (includeDomains?.length) body.includeDomains = includeDomains;
  if (excludeDomains?.length) body.excludeDomains = excludeDomains;
  if (scrapeTopHits) body.scrapeOptions = { formats: [{ type: 'markdown' }] };

  if (costTracker) costTracker.addFirecrawlCall();

  try {
    const res = await fetch(`${FIRECRAWL_BASE_URL}/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONFIG.firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Log the response body too, not just the status - same fix as clients/pdl.ts. Without
      // this, a real Firecrawl rejection (bad/expired key, quota exhausted, malformed request)
      // was indistinguishable in the logs from "search genuinely found nothing," which made
      // this exact failure mode impossible to diagnose remotely.
      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch {
        // best-effort
      }
      console.error(`[firecrawl] HTTP ${res.status} for query "${query}" - body: ${bodyText.slice(0, 1000)}`);
      return { success: false, results: [], creditsUsed: 0 };
    }

    const json: any = await res.json();
    if (!json.success) {
      console.error(`[firecrawl] success:false for query "${query}" - response: ${JSON.stringify(json).slice(0, 1000)}`);
      return { success: false, results: [], creditsUsed: 0 };
    }

    const web = json.data?.web ?? [];
    const results: FirecrawlSearchResult[] = web.map((w: any) => ({
      title: w.title,
      description: w.description,
      url: w.url,
      markdown: w.markdown,
    }));

    return { success: true, results, creditsUsed: json.creditsUsed ?? results.length };
  } catch (err: any) {
    console.error(`[firecrawl] request failed for query "${query}": ${err?.message ?? err}`);
    return { success: false, results: [], creditsUsed: 0 };
  }
}

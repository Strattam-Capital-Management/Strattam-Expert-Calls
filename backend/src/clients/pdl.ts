import { CONFIG } from '../config';
import type { CostTracker } from '../costTracker';

export interface PdlPerson {
  full_name?: string;
  job_title?: string;
  job_company_name?: string;
  linkedin_url?: string;
  experience?: Array<{
    title?: { name?: string };
    company?: { name?: string };
    start_date?: string;
    end_date?: string;
    is_primary?: boolean;
  }>;
  [key: string]: unknown;
}

export interface PdlSearchResponse {
  success: boolean;
  data: PdlPerson[];
  total: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PDL_URL = 'https://api.peopledatalabs.com/v5/person/search';

/**
 * Wraps PDL's POST /person/search using the Elasticsearch `query` DSL (never `sql` - SQL mode
 * doesn't reliably match "any element of an array field", which is exactly what "did this
 * person ever work at company X" requires against the `experience` array).
 *
 * Callers of this function are responsible for building `query` objects that respect PDL's
 * constraints: only term/terms/exists/bool/match/range/match_phrase/wildcard/prefix/match_all
 * clause types are accepted (no `nested`, no `minimum_should_match` - both 400 error on PDL even
 * though they're valid vanilla Elasticsearch). See peopleSearch.ts for the query builder.
 *
 * PDL's default rate limit is 10 requests/minute per key, so this does one retry-with-backoff
 * on HTTP 429 and otherwise expects the caller to throttle concurrency externally.
 *
 * Billing is per record RETURNED in `data` (each row is a credit) - the caller passes a
 * CostTracker so that's reflected in the run's PDL cost estimate.
 */
export async function pdlPersonSearch(
  query: unknown,
  size: number,
  costTracker?: CostTracker
): Promise<PdlSearchResponse> {
  if (!CONFIG.pdlApiKey) {
    console.warn('[pdl] PDL_API_KEY not configured; skipping person search');
    return { success: false, data: [], total: 0 };
  }

  const attempt = (): Promise<Response> =>
    fetch(PDL_URL, {
      method: 'POST',
      headers: {
        'X-Api-Key': CONFIG.pdlApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, size }),
    });

  try {
    let res = await attempt();

    if (res.status === 429) {
      console.warn('[pdl] 429 rate limited, retrying once after backoff');
      await sleep(4000);
      res = await attempt();
    }

    if (!res.ok) {
      console.error(`[pdl] HTTP ${res.status} for person search`);
      return { success: false, data: [], total: 0 };
    }

    const json: any = await res.json();
    const data: PdlPerson[] = json.data ?? [];
    if (costTracker) costTracker.addPdlRecords(data.length);
    return { success: true, data, total: json.total ?? data.length };
  } catch (err: any) {
    console.error(`[pdl] request failed: ${err?.message ?? err}`);
    return { success: false, data: [], total: 0 };
  }
}

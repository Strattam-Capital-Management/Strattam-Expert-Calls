import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function envFloat(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

export const CONFIG = {
  port: envInt('PORT', 8787),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY ?? '',
  pdlApiKey: process.env.PDL_API_KEY ?? '',
  // Grata: used to ground company research (competitors/similar companies/firmographics) in
  // real structured data instead of LLM-inferred lists, and - if the account's plan includes
  // the Data Warehouse / executive-contacts module - as a third people-search source alongside
  // PDL and web research. No-op if unset (same graceful-degradation pattern as Firecrawl/PDL).
  grataApiKey: process.env.GRATA_API_KEY ?? '',
  // Raylu: reserved, NOT wired into the pipeline yet. Raylu's public docs (docs.raylu.ai) only
  // cover their no-code workflow builder, not a versioned REST API reference - the actual
  // request/response contract needs to come from Raylu's account team before real calls can be
  // written with confidence. Keeping the key here so it's a one-file change (clients/raylu.ts)
  // once that contract is confirmed, rather than a design change.
  rayluApiKey: process.env.RAYLU_API_KEY ?? '',
  // Google Custom Search: an optional second web-search backend alongside Firecrawl, used
  // mainly for `site:`-scoped queries (g2.com, capterra.com, gartner.com, .edu, linkedin.com/in
  // search-result snippets - never scraped page content) that surface the newer, non-employee
  // archetype categories (industry analysts, academics, product reviewers, etc). See
  // clients/googleCse.ts. No-op if unset.
  googleCseApiKey: process.env.GOOGLE_CSE_API_KEY ?? '',
  googleCseCx: process.env.GOOGLE_CSE_CX ?? '',
  accessCode: process.env.ACCESS_CODE ?? '',
  dbPath: process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'sourcer.db'),
  cacheTtlDays: envInt('CACHE_TTL_DAYS', 30),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  pdlConcurrency: envInt('PDL_CONCURRENCY', 3),
  // NOTE: these are configurable ESTIMATE constants, not Strattam's actual contracted rates.
  // Firecrawl and PDL bill per-call / per-record and the exact rate isn't in the API response,
  // so cost totals derived from these are labelled "estimated" everywhere they surface.
  // Double check against the firm's actual PDL and Firecrawl plans before relying on them for budgeting.
  pdlCostPerRecordUsd: envFloat('PDL_COST_PER_RECORD_USD', 0.28),
  firecrawlCostPerCallUsd: envFloat('FIRECRAWL_COST_PER_CALL_USD', 0.012),
  // Grata is typically sold as a seat/credit subscription, not metered pay-per-call like
  // Firecrawl - this constant is a rough per-call estimate for the cost breakdown's sake only.
  // Check it against the firm's actual Grata contract before trusting it for budgeting.
  grataCostPerCallUsd: envFloat('GRATA_COST_PER_CALL_USD', 0.05),
  // Google's published rate above the free 100 queries/day tier is roughly $5 per 1,000 queries
  // ($0.005/query) as of this writing - same "estimate constant, verify before budgeting" caveat
  // as the others above.
  googleCseCostPerCallUsd: envFloat('GOOGLE_CSE_COST_PER_CALL_USD', 0.005),
};

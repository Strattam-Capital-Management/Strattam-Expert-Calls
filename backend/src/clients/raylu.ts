import { CONFIG } from '../config';

/**
 * Raylu is deliberately NOT wired into the pipeline yet - this file is a placeholder, not a
 * working client. Do not import/call `rayluMarketMap` from research.ts or anywhere else until
 * the note below is resolved.
 *
 * Why: every other external client in this backend (anthropic.ts, firecrawl.ts, pdl.ts,
 * grata.ts) was written against a real, publicly-checkable API reference - endpoint paths,
 * auth scheme, and request/response shapes. Raylu's public docs (docs.raylu.ai) only describe
 * their no-code visual workflow builder ("drag and drop actions to create custom workflows") -
 * there is no versioned REST API reference publicly available to write real endpoint-calling
 * code against. Their own onboarding doc says as much: further help comes from "your dedicated
 * Account Representative," which suggests integration is typically arranged directly with their
 * team (e.g. a custom workflow/webhook/export they build for you) rather than a self-serve
 * documented API surface the way Grata's is.
 *
 * Writing a client against a guessed endpoint here would look done without being done - it
 * would compile and even fail gracefully like the other clients, but every field mapping would
 * be fabricated. That runs against this whole tool's own first principle (never invent a
 * candidate or a fact), so it's been left undone on purpose.
 *
 * To finish this: get the real API contract from your Raylu account rep (endpoint(s), auth
 * header, and the exact shape of a market-map / company-discovery response), then implement
 * `rayluMarketMap` below following the same pattern as `grataEnrichCompany` in grata.ts -
 * bearer-or-key auth in one shared header function, graceful degradation on any non-2xx or
 * network error, and a `costTracker.addRayluCall()` (add that method to CostTracker, mirroring
 * `addGrataCall`) so its cost shows up in the itemized breakdown. Then call it from research.ts
 * to enrich profile.competitors the same way grataEnrichCompany's similar-companies data does.
 */

export interface RayluMarketMapResult {
  success: false;
  reason: 'not_implemented';
}

export async function rayluMarketMap(_companyNameOrThesis: string): Promise<RayluMarketMapResult> {
  if (CONFIG.rayluApiKey) {
    console.warn(
      '[raylu] RAYLU_API_KEY is set but this client is not implemented yet - see the comment at the top of clients/raylu.ts for what is needed to finish it.'
    );
  }
  return { success: false, reason: 'not_implemented' };
}

import { Router } from 'express';
import { getModelList } from '../pricing';
import { CONFIG } from '../config';

export const costRouter = Router();

costRouter.get('/cost/models', (_req, res) => {
  res.json({ models: getModelList() });
});

costRouter.post('/cost/estimate', (req, res) => {
  const model = typeof req.body?.model === 'string' ? req.body.model : '';
  const info = getModelList().find((m) => m.id === model);

  if (!info) {
    res.status(400).json({ error: `Unknown model id: ${model}` });
    return;
  }

  // Rough range based on typical run sizes: company research + one combined buckets/archetypes
  // call + roughly 20-40 sourced candidates scored/mapped in batches of ~8, plus a handful of
  // Firecrawl search calls and PDL record lookups at the configured estimate constants.
  const claudeLowUsd = (info.inputPerM * 60_000 + info.outputPerM * 20_000) / 1_000_000;
  const claudeHighUsd = (info.inputPerM * 150_000 + info.outputPerM * 60_000) / 1_000_000;
  const firecrawlLowUsd = 15 * CONFIG.firecrawlCostPerCallUsd;
  const firecrawlHighUsd = 40 * CONFIG.firecrawlCostPerCallUsd;
  const pdlLowUsd = 20 * CONFIG.pdlCostPerRecordUsd;
  const pdlHighUsd = 80 * CONFIG.pdlCostPerRecordUsd;

  res.json({
    model,
    estimatedLowUsd: Math.round((claudeLowUsd + firecrawlLowUsd + pdlLowUsd) * 100) / 100,
    estimatedHighUsd: Math.round((claudeHighUsd + firecrawlHighUsd + pdlHighUsd) * 100) / 100,
    note:
      "This is a rough planning range, not a quote. Unlike a fixed-row CSV scorer, this pipeline's " +
      'research volume and candidate count vary by company - how much public material exists, and ' +
      'how many named individuals turn up - so an actual run can land outside this range. Firecrawl ' +
      'and PDL figures use configurable per-call/per-record estimate constants (see .env) that should ' +
      "be checked against Strattam's actual contracted rates. Each completed run's CostSummary reports " +
      'EXACT Claude token cost (from real Anthropic API usage) and ESTIMATED Firecrawl/PDL cost.',
  });
});

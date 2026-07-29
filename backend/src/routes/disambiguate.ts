import { Router } from 'express';
import { firecrawlSearch } from '../clients/firecrawl';
import { callClaude, extractJson } from '../clients/anthropic';
import { DISAMBIGUATION_SYSTEM_PROMPT } from '../prompts/disambiguation';

export const disambiguateRouter = Router();

// Deliberately not user-selectable: this endpoint is meant to be cheap and fast (single
// Firecrawl search + one small Claude call), run BEFORE the user picks a model for the full
// pipeline on POST /run/start.
const DISAMBIGUATION_MODEL = 'claude-haiku-4-5-20251001';

disambiguateRouter.post('/company/disambiguate', async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    res.status(400).json({ error: 'Missing required field: query' });
    return;
  }

  try {
    const searchResult = await firecrawlSearch({ query: `${query} company official site`, limit: 10 });

    if (!searchResult.success || searchResult.results.length === 0) {
      res.json({ candidates: [] });
      return;
    }

    const snippetText = searchResult.results
      .map((r) => `URL: ${r.url}\nTITLE: ${r.title ?? ''}\nSNIPPET: ${r.description ?? ''}`)
      .join('\n\n---\n\n')
      .slice(0, 12_000);

    const userMessage = `User-typed company name: "${query}"

Web search snippets:

${snippetText}

Identify up to 5 distinct real companies matching this. Return JSON only.`;

    const result = await callClaude({
      model: DISAMBIGUATION_MODEL,
      system: DISAMBIGUATION_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 1200,
      stepName: 'company-disambiguation',
    });

    const parsed = extractJson(result.text);
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 5) : [];
    res.json({ candidates });
  } catch (err: any) {
    console.error('[disambiguate] failed:', err);
    res.status(500).json({ error: err?.message ?? 'Disambiguation failed' });
  }
});

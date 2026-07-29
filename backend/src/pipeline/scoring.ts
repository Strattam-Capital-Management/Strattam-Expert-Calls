import { callClaude, extractJson } from '../clients/anthropic';
import { SCORING_SYSTEM_PROMPT } from '../prompts/scoring';
import type { CandidateDraft, CandidateScored, CompanyProfile } from '../types';
import type { CostTracker } from '../costTracker';

const BATCH_SIZE = 8;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Stage 6 of the pipeline. Batches candidates into Claude calls of BATCH_SIZE (not one call
 * per candidate) to control cost/latency. max_tokens is sized generously for the batch, and
 * callClaude() throws loudly if the response was truncated (stop_reason="max_tokens") rather
 * than silently falling back to partial data.
 */
export async function scoreCandidates(
  candidates: CandidateDraft[],
  profile: CompanyProfile,
  thesis: string | undefined,
  model: string,
  costTracker: CostTracker
): Promise<CandidateScored[]> {
  const batches = chunk(candidates, BATCH_SIZE);
  const scored: CandidateScored[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    const userMessage = `Target company: ${profile.companyName}
Industry: ${profile.industry}
Investment thesis: ${thesis ?? '(none provided)'}

Candidates to score (JSON array):
${JSON.stringify(
  batch.map((c) => ({
    id: c.id,
    name: c.name,
    currentCompany: c.currentCompany,
    currentTitle: c.currentTitle,
    formerCompany: c.formerCompany,
    formerTitle: c.formerTitle,
    relevantRole: c.relevantRole,
    relationshipToTarget: c.relationshipToTarget,
    tenureNote: c.tenureNote,
  })),
  null,
  2
)}

Return a JSON object: {"scores": [{"id": string, "score": number}]} with exactly one entry per
candidate id above.`;

    const result = await callClaude({
      model,
      system: SCORING_SYSTEM_PROMPT,
      userMessage,
      // Generous ceiling for an 8-candidate batch's worth of {id, score} pairs.
      maxTokens: 2000,
      stepName: `scoring-batch-${batchIndex + 1}-of-${batches.length}`,
      costTracker,
    });

    const parsed = extractJson(result.text);
    const scoreMap = new Map<string, number>();
    for (const s of parsed.scores ?? []) {
      const clamped = Math.max(0, Math.min(100, Math.round(Number(s.score))));
      scoreMap.set(s.id, clamped);
    }

    for (const c of batch) {
      const score = scoreMap.get(c.id);
      if (score === undefined) {
        console.warn(`[scoring] no score returned for candidate ${c.id} (${c.name}); defaulting to 0`);
      }
      scored.push({ ...c, confidenceScore: score ?? 0 });
    }
  }

  return scored;
}

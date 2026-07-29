import { callClaude, extractJson } from '../clients/anthropic';
import { QUESTION_MAPPING_SYSTEM_PROMPT } from '../prompts/questionMapping';
import type { CandidateMapped, CandidateScored, CompanyProfile, DiligenceQuestion } from '../types';
import type { CostTracker } from '../costTracker';

const BATCH_SIZE = 8;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Stage 7 of the pipeline. Maps each candidate to the diligence questions they're best
 * positioned to answer, with a short reason for inclusion emphasizing likely information
 * asymmetry. Batched like scoring.ts to control cost/latency, with the same truncation
 * safety net inside callClaude().
 */
export async function mapCandidatesToQuestions(
  candidates: CandidateScored[],
  questions: DiligenceQuestion[],
  profile: CompanyProfile,
  model: string,
  costTracker: CostTracker
): Promise<CandidateMapped[]> {
  const batches = chunk(candidates, BATCH_SIZE);
  const mapped: CandidateMapped[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    const userMessage = `Target company: ${profile.companyName}

Diligence questions:
${JSON.stringify(questions, null, 2)}

Candidates:
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

For each candidate, return the diligence question ids they are best positioned to answer and a
short reason for inclusion. Return JSON:
{"mappings": [{"id": string, "bestDiligenceQuestionIds": string[], "reasonForInclusion": string}]}`;

    const result = await callClaude({
      model,
      system: QUESTION_MAPPING_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 3000,
      stepName: `question-mapping-batch-${batchIndex + 1}-of-${batches.length}`,
      costTracker,
    });

    const parsed = extractJson(result.text);
    const byId = new Map<string, { bestDiligenceQuestionIds: string[]; reasonForInclusion: string }>();
    for (const m of parsed.mappings ?? []) {
      byId.set(m.id, {
        bestDiligenceQuestionIds: Array.isArray(m.bestDiligenceQuestionIds) ? m.bestDiligenceQuestionIds : [],
        reasonForInclusion: m.reasonForInclusion ?? '',
      });
    }

    for (const c of batch) {
      const m = byId.get(c.id);
      mapped.push({
        ...c,
        bestDiligenceQuestionIds: m?.bestDiligenceQuestionIds ?? [],
        reasonForInclusion: m?.reasonForInclusion || 'Background aligns with this expertise bucket based on stated role and relationship to the target.',
      });
    }
  }

  return mapped;
}

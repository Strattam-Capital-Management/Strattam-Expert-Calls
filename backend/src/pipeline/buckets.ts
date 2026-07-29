import { callClaude, extractJson } from '../clients/anthropic';
import { BUCKETS_ARCHETYPES_SYSTEM_PROMPT } from '../prompts/bucketsArchetypes';
import type { CompanyProfile, Bucket, Archetype } from '../types';
import type { CostTracker } from '../costTracker';

/**
 * Stages 2 + 3 of the pipeline, combined into one Claude call (returns {buckets, archetypes}
 * together) to reduce latency/cost, per the pipeline design. Buckets are 6-8 expertise
 * categories tailored to THIS company's actual value drivers/industry - never a generic fixed
 * list. Archetypes are 1-2 specific job titles per bucket most likely to hold high-value
 * non-public information, favoring direct operational ownership and former employees of the
 * target/named competitors/suppliers/customers over generic commentators.
 */
export async function generateBucketsAndArchetypes(
  profile: CompanyProfile,
  thesis: string | undefined,
  model: string,
  costTracker: CostTracker
): Promise<{ buckets: Bucket[]; archetypes: Archetype[] }> {
  const userMessage = `Company profile JSON:
${JSON.stringify(profile, null, 2)}

Investment thesis (if provided): ${thesis ?? '(none provided)'}

Propose 6-8 expertise buckets tailored specifically to this company's actual value drivers and
industry, and for each bucket 1-2 specific candidate archetypes (job titles) most likely to
hold high-value non-public information. Return JSON only, matching the schema in your system
prompt.`;

  const result = await callClaude({
    model,
    system: BUCKETS_ARCHETYPES_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 3000,
    stepName: 'buckets-and-archetypes',
    costTracker,
  });

  const parsed = extractJson(result.text);

  const buckets: Bucket[] = (parsed.buckets ?? []).map((b: any, i: number) => ({
    id: b.id ?? `bucket-${i + 1}`,
    name: b.name ?? `Bucket ${i + 1}`,
    rationale: b.rationale ?? '',
  }));

  const bucketIds = new Set(buckets.map((b) => b.id));
  const archetypes: Archetype[] = (parsed.archetypes ?? [])
    .filter((a: any) => bucketIds.has(a.bucketId))
    .map((a: any) => ({
      bucketId: a.bucketId,
      title: a.title,
      whyValuable: a.whyValuable ?? '',
    }));

  return { buckets, archetypes };
}

import { callClaude, extractJson } from '../clients/anthropic';
import { BUCKETS_ARCHETYPES_SYSTEM_PROMPT } from '../prompts/bucketsArchetypes';
import type { CompanyProfile, Bucket, Archetype, ArchetypeCategory } from '../types';
import type { CostTracker } from '../costTracker';

const VALID_CATEGORIES = new Set<ArchetypeCategory>([
  'target_employee',
  'competitor_employee',
  'customer',
  'channel_partner',
  'supplier',
  'industry_analyst',
  'academic',
  'consultant',
  'trade_association',
  'conference_speaker',
  'product_reviewer',
]);

/** Falls back to 'target_employee' (the pipeline's original, most-conservative behavior) if
 * Claude returns a category outside the fixed list - this should be rare given the schema is
 * spelled out explicitly in the system prompt, but a malformed/missing category should degrade
 * gracefully rather than crash the run or silently drop the archetype. */
function normalizeCategory(raw: unknown): ArchetypeCategory {
  if (typeof raw === 'string' && VALID_CATEGORIES.has(raw as ArchetypeCategory)) {
    return raw as ArchetypeCategory;
  }
  return 'target_employee';
}

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
industry, and for each bucket 2-3 specific candidate archetypes (job titles), each tagged with
a category per your system prompt. Spread the archetypes across at least 5 different
categories overall - reach well beyond just the target's own former employees. Return JSON
only, matching the schema in your system prompt.`;

  const result = await callClaude({
    model,
    system: BUCKETS_ARCHETYPES_SYSTEM_PROMPT,
    userMessage,
    // Was 3000, sized for the original 6-8 buckets x 1-2 archetypes with no category field.
    // Asking for 6-8 buckets x 2-3 archetypes (up to 24) each with title + whyValuable + a new
    // category field is a meaningfully bigger JSON payload - 3000 was too tight and caused real
    // truncation failures (this step correctly refuses to proceed on partial JSON rather than
    // silently using a broken list, so it errored loudly instead of returning garbage - but the
    // real fix is giving it enough room in the first place).
    maxTokens: 6000,
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
      category: normalizeCategory(a.category),
    }));

  return { buckets, archetypes };
}

import Anthropic from '@anthropic-ai/sdk';
import { CONFIG } from '../config';
import type { CostTracker } from '../costTracker';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: CONFIG.anthropicApiKey || 'missing-api-key' });
  }
  return client;
}

export interface ClaudeCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
}

export interface CallClaudeOpts {
  model: string;
  system: string;
  userMessage: string;
  maxTokens: number;
  /** Name of the pipeline step, used only to make truncation/error messages actionable. */
  stepName: string;
  costTracker?: CostTracker;
}

/**
 * Thin wrapper around the Anthropic Messages API that enforces two invariants required by
 * the pipeline design:
 *   1. Every call's stop_reason is checked. A stop_reason of "max_tokens" means the response
 *      was truncated - we throw a loud, named error rather than silently returning partial
 *      JSON that a caller might otherwise half-parse into fabricated/incomplete data.
 *   2. Real input/output token usage is recorded on the CostTracker so the run's Claude cost
 *      is EXACT (as opposed to Firecrawl/PDL costs, which are estimated).
 */
export async function callClaude(opts: CallClaudeOpts): Promise<ClaudeCallResult> {
  const { model, system, userMessage, maxTokens, stepName, costTracker } = opts;

  if (!CONFIG.anthropicApiKey) {
    throw new Error(`[${stepName}] ANTHROPIC_API_KEY is not configured`);
  }

  let resp;
  try {
    resp = await getClient().messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err: any) {
    const status = err?.status;
    if (status === 401) {
      throw new Error(
        `[${stepName}] Anthropic authentication failed (401) - check that ANTHROPIC_API_KEY is valid and not revoked.`
      );
    }
    throw new Error(`[${stepName}] Anthropic call failed: ${err?.message ?? String(err)}`);
  }

  if (resp.stop_reason === 'max_tokens') {
    throw new Error(
      `[${stepName}] Claude response was truncated (stop_reason="max_tokens") using model=${model}, max_tokens=${maxTokens}. ` +
        `Increase max_tokens or reduce the batch size for this step - refusing to proceed on partial JSON.`
    );
  }

  const textBlock = resp.content.find((c: any) => c.type === 'text') as { type: 'text'; text: string } | undefined;
  const text = textBlock?.text ?? '';
  const inputTokens = resp.usage?.input_tokens ?? 0;
  const outputTokens = resp.usage?.output_tokens ?? 0;

  if (costTracker) {
    costTracker.addClaude(model, inputTokens, outputTokens);
  }

  return { text, inputTokens, outputTokens, stopReason: resp.stop_reason };
}

/**
 * Best-effort JSON extraction from a Claude text response. Claude is instructed in every
 * system prompt to return JSON only, but this defensively handles markdown code fences or
 * incidental leading/trailing prose in case the model doesn't comply exactly.
 */
export function extractJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // fall through
    }
  }

  const firstObj = text.indexOf('{');
  const lastObj = text.lastIndexOf('}');
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    try {
      return JSON.parse(text.slice(firstObj, lastObj + 1));
    } catch {
      // fall through
    }
  }

  const firstArr = text.indexOf('[');
  const lastArr = text.lastIndexOf(']');
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    try {
      return JSON.parse(text.slice(firstArr, lastArr + 1));
    } catch {
      // fall through
    }
  }

  throw new Error(`Could not extract JSON from Claude response. First 500 chars: ${text.slice(0, 500)}`);
}

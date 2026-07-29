import type { ModelInfo } from './types';

// Claude Sonnet 5 has a promotional rate through 2026-08-31, then reverts to its standard rate.
// Keeping both rates + the cutover date here means /cost/models and cost calculations are
// correct on either side of that date without a manual code change.
const SONNET_CUTOVER_UTC = new Date('2026-09-01T00:00:00Z');
const SONNET_PROMO_RATE = { inputPerM: 2.0, outputPerM: 10.0 };
const SONNET_STANDARD_RATE = { inputPerM: 3.0, outputPerM: 15.0 };

function sonnetRate(now: Date): { inputPerM: number; outputPerM: number } {
  return now < SONNET_CUTOVER_UTC ? SONNET_PROMO_RATE : SONNET_STANDARD_RATE;
}

export function getModelList(now: Date = new Date()): ModelInfo[] {
  const sonnet = sonnetRate(now);
  return [
    {
      id: 'claude-haiku-4-5-20251001',
      label: 'Claude Haiku 4.5',
      blurb: 'Cheap workhorse. Best for extraction and other high-volume steps.',
      inputPerM: 1.0,
      outputPerM: 5.0,
    },
    {
      id: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      blurb: `Balanced default. $${sonnet.inputPerM.toFixed(2)}/$${sonnet.outputPerM.toFixed(
        2
      )} per million tokens through Aug 31 2026, then $3.00/$15.00 standard rate.`,
      inputPerM: sonnet.inputPerM,
      outputPerM: sonnet.outputPerM,
    },
    {
      id: 'claude-opus-5',
      label: 'Claude Opus 5',
      blurb: 'Sharpest and priciest. Best for final scoring/synthesis on high-stakes runs.',
      inputPerM: 5.0,
      outputPerM: 25.0,
    },
  ];
}

export function claudeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  now: Date = new Date()
): number {
  const models = getModelList(now);
  const info = models.find((m) => m.id === model) ?? models[1]; // fall back to Sonnet rates for unknown model ids
  return (inputTokens / 1_000_000) * info.inputPerM + (outputTokens / 1_000_000) * info.outputPerM;
}

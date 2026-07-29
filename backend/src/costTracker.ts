import { claudeCost } from './pricing';
import { CONFIG } from './config';
import type { CostSummary } from './types';

interface ClaudeUsageEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Accumulates real Claude token usage plus Firecrawl/PDL call counts across a single
 * pipeline run, then produces the CostSummary the frontend renders. Claude cost is EXACT
 * (real usage tokens from the Anthropic API response). Firecrawl and PDL costs are
 * ESTIMATED (per-call / per-record constants) - both are labelled accordingly in the
 * breakdown so the UI can display the distinction honestly.
 */
export class CostTracker {
  private claudeUsage: ClaudeUsageEntry[] = [];
  private firecrawlCalls = 0;
  private pdlRecords = 0;
  private grataCalls = 0;

  addClaude(model: string, inputTokens: number, outputTokens: number): void {
    this.claudeUsage.push({ model, inputTokens, outputTokens });
  }

  addFirecrawlCall(n = 1): void {
    this.firecrawlCalls += n;
  }

  addPdlRecords(n: number): void {
    this.pdlRecords += n;
  }

  addGrataCall(n = 1): void {
    this.grataCalls += n;
  }

  summarize(): CostSummary {
    const byModel = new Map<string, { input: number; output: number }>();
    for (const u of this.claudeUsage) {
      const cur = byModel.get(u.model) ?? { input: 0, output: 0 };
      cur.input += u.inputTokens;
      cur.output += u.outputTokens;
      byModel.set(u.model, cur);
    }

    let claudeUsd = 0;
    const breakdown: CostSummary['breakdown'] = [];

    for (const [model, usage] of byModel.entries()) {
      const usd = claudeCost(model, usage.input, usage.output);
      claudeUsd += usd;
      breakdown.push({
        label: `Claude (${model}) - ${usage.input.toLocaleString()} input / ${usage.output.toLocaleString()} output tokens`,
        usd: round2(usd),
        basis: 'exact',
      });
    }

    const firecrawlUsd = this.firecrawlCalls * CONFIG.firecrawlCostPerCallUsd;
    const pdlUsd = this.pdlRecords * CONFIG.pdlCostPerRecordUsd;

    if (this.firecrawlCalls > 0) {
      breakdown.push({
        label: `Firecrawl - ${this.firecrawlCalls} search call(s) at an estimated $${CONFIG.firecrawlCostPerCallUsd}/call`,
        usd: round2(firecrawlUsd),
        basis: 'estimated',
      });
    }

    if (this.pdlRecords > 0) {
      breakdown.push({
        label: `People Data Labs - ${this.pdlRecords} record(s) returned at an estimated $${CONFIG.pdlCostPerRecordUsd}/record`,
        usd: round2(pdlUsd),
        basis: 'estimated',
      });
    }

    const grataUsd = this.grataCalls * CONFIG.grataCostPerCallUsd;
    if (this.grataCalls > 0) {
      breakdown.push({
        label: `Grata - ${this.grataCalls} API call(s) at an estimated $${CONFIG.grataCostPerCallUsd}/call`,
        usd: round2(grataUsd),
        basis: 'estimated',
      });
    }

    // NOTE: Grata doesn't get its own named top-level field (unlike claudeUsd/firecrawlUsd/
    // pdlUsd) to avoid a breaking change to the CostSummary shape the frontend already renders -
    // it only ever reads `breakdown` (itemized) and `totalUsd`, both of which fully reflect
    // Grata's cost. Same approach should be used for Raylu once that's wired in for real.
    const totalUsd = claudeUsd + firecrawlUsd + pdlUsd + grataUsd;

    return {
      claudeUsd: round2(claudeUsd),
      firecrawlUsd: round2(firecrawlUsd),
      pdlUsd: round2(pdlUsd),
      totalUsd: round2(totalUsd),
      breakdown,
    };
  }
}

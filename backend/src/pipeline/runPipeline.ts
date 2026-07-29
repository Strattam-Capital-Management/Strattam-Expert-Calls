import { updateRunStage, completeRun, failRun } from '../db';
import { CostTracker } from '../costTracker';
import { researchCompany } from './research';
import { generateBucketsAndArchetypes } from './buckets';
import { sourceCandidates } from './peopleSearch';
import { findOutsideTheBoxCandidates } from './outsideTheBox';
import { applyComplianceFilter } from './compliance';
import { scoreCandidates } from './scoring';
import { mapCandidatesToQuestions } from './questionMapping';
import { tierCandidates } from './tiering';
import { computeCoverage } from './coverage';
import { DEFAULT_DILIGENCE_QUESTIONS } from '../prompts/defaultQuestions';
import type { DiligenceQuestion, RunResult } from '../types';

export interface RunPipelineParams {
  runId: string;
  companyName: string;
  companyHint?: string;
  thesis?: string;
  diligenceQuestions?: DiligenceQuestion[];
  model: string;
}

/**
 * Stage 13: orchestrates the full 13-step pipeline, updating the run's `stage` field in
 * SQLite after each step so GET /run/:id shows live progress. This function is intentionally
 * NOT awaited by its caller (POST /run/start) - it is fired-and-forgotten so the HTTP request
 * that starts a run can return {runId} immediately, which is why this backend must run as an
 * always-on Node process rather than a serverless function with a duration cap.
 */
export function runPipelineInBackground(params: RunPipelineParams): void {
  runPipeline(params).catch((err) => {
    // Should be unreachable - runPipeline() has its own internal try/catch that calls
    // failRun() - but guarding here means an unexpected throw never becomes an unhandled
    // promise rejection that could crash the always-on process.
    console.error(`[runPipeline] unhandled error for run ${params.runId}:`, err);
    try {
      failRun(params.runId, `Unhandled pipeline error: ${err?.message ?? String(err)}`);
    } catch {
      // best-effort
    }
  });
}

async function runPipeline(params: RunPipelineParams): Promise<void> {
  const { runId, companyName, companyHint, thesis, model } = params;
  const diligenceQuestions = params.diligenceQuestions?.length ? params.diligenceQuestions : DEFAULT_DILIGENCE_QUESTIONS;
  const costTracker = new CostTracker();

  try {
    updateRunStage(runId, 'researching_company');
    const { profile, grataExecutives } = await researchCompany(companyName, companyHint, model, costTracker);

    updateRunStage(runId, 'generating_expertise_buckets_and_archetypes');
    const { buckets, archetypes } = await generateBucketsAndArchetypes(profile, thesis, model, costTracker);

    updateRunStage(runId, 'sourcing_candidates');
    const coreCandidates = await sourceCandidates(
      archetypes,
      buckets,
      companyName,
      companyHint,
      profile,
      model,
      costTracker,
      grataExecutives
    );

    updateRunStage(runId, 'searching_outside_the_box_experts');
    const outsideCandidates = await findOutsideTheBoxCandidates(
      companyName,
      companyHint,
      profile,
      buckets,
      model,
      costTracker
    );

    const allDrafts = [...coreCandidates, ...outsideCandidates];

    updateRunStage(runId, 'running_compliance_filter');
    const { survivors, hardRemovedCount, flaggedCompetitorCount } = applyComplianceFilter(
      allDrafts,
      companyName,
      profile,
      companyHint
    );

    updateRunStage(runId, 'scoring_candidates');
    const scored = await scoreCandidates(survivors, profile, thesis, model, costTracker);

    updateRunStage(runId, 'mapping_diligence_questions');
    const mapped = await mapCandidatesToQuestions(scored, diligenceQuestions, profile, model, costTracker);

    updateRunStage(runId, 'tiering_and_grouping_candidates');
    const tiered = tierCandidates(mapped).sort((a, b) => {
      if (a.expertiseBucketId !== b.expertiseBucketId) {
        return a.expertiseBucketId.localeCompare(b.expertiseBucketId);
      }
      return b.confidenceScore - a.confidenceScore;
    });

    updateRunStage(runId, 'computing_coverage');
    const coverage = computeCoverage(tiered, buckets);

    const result: RunResult = {
      companyProfile: profile,
      buckets,
      archetypes,
      diligenceQuestions,
      candidates: tiered,
      coverage,
      complianceSummary: { hardRemovedCount, flaggedCompetitorCount },
    };

    const cost = costTracker.summarize();
    completeRun(runId, JSON.stringify(result), JSON.stringify(cost));
  } catch (err: any) {
    console.error(`[runPipeline] run ${runId} failed:`, err);
    const cost = costTracker.summarize();
    failRun(runId, err?.message ?? String(err), JSON.stringify(cost));
  }
}

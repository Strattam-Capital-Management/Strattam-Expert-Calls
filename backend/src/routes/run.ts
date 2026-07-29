import { Router } from 'express';
import * as crypto from 'crypto';
import { createRun, getRun } from '../db';
import { runPipelineInBackground } from '../pipeline/runPipeline';
import { buildWorkbook } from '../export/xlsx';
import { getModelList } from '../pricing';
import type { CostSummary, DiligenceQuestion, RunResult, RunStatusResponse } from '../types';

export const runRouter = Router();

function isValidModel(model: string): boolean {
  return getModelList().some((m) => m.id === model);
}

runRouter.post('/run/start', (req, res) => {
  const companyName = typeof req.body?.companyName === 'string' ? req.body.companyName.trim() : '';
  const companyHint = typeof req.body?.companyHint === 'string' ? req.body.companyHint.trim() : undefined;
  const thesis = typeof req.body?.thesis === 'string' ? req.body.thesis.trim() : undefined;
  const model = typeof req.body?.model === 'string' ? req.body.model : '';
  const diligenceQuestions: DiligenceQuestion[] | undefined = Array.isArray(req.body?.diligenceQuestions)
    ? req.body.diligenceQuestions
    : undefined;

  if (!companyName) {
    res.status(400).json({ error: 'Missing required field: companyName' });
    return;
  }
  if (!isValidModel(model)) {
    res.status(400).json({ error: `Missing or unknown model id: ${model}` });
    return;
  }

  const runId = crypto.randomUUID();

  createRun({
    id: runId,
    companyName,
    companyHint,
    thesis,
    diligenceQuestionsJson: diligenceQuestions ? JSON.stringify(diligenceQuestions) : undefined,
    model,
  });

  // Fire-and-forget: the pipeline runs in the background (this backend is an always-on Node
  // process, not a serverless function with a duration cap), so this handler returns
  // immediately without awaiting the pipeline.
  runPipelineInBackground({ runId, companyName, companyHint, thesis, diligenceQuestions, model });

  res.json({ runId });
});

runRouter.get('/run/:id', (req, res) => {
  const row = getRun(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }

  const response: RunStatusResponse = {
    runId: row.id,
    status: row.status,
    stage: row.stage,
  };
  if (row.error) response.error = row.error;
  if (row.result_json) response.result = JSON.parse(row.result_json) as RunResult;
  if (row.cost_json) response.cost = JSON.parse(row.cost_json) as CostSummary;

  res.json(response);
});

runRouter.get('/run/:id/export.xlsx', async (req, res) => {
  const row = getRun(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  if (!row.result_json) {
    res.status(409).json({ error: 'Run has no result yet - it may still be running or may have errored out' });
    return;
  }

  try {
    const result = JSON.parse(row.result_json) as RunResult;
    const cost = row.cost_json ? (JSON.parse(row.cost_json) as CostSummary) : undefined;

    const workbook = await buildWorkbook({
      result,
      cost,
      companyName: row.company_name,
      thesis: row.thesis ?? undefined,
      model: row.model,
      startedAt: row.started_at,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${row.company_name.replace(/[^a-z0-9]+/gi, '-')}-expert-candidates.xlsx"`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error('[export.xlsx] failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message ?? 'Failed to build export' });
    } else {
      res.end();
    }
  }
});

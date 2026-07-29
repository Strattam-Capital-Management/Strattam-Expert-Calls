import ExcelJS from 'exceljs';
import type { CostSummary, RunResult } from '../types';

export interface BuildWorkbookParams {
  result: RunResult;
  cost?: CostSummary;
  companyName: string;
  thesis?: string;
  model: string;
  startedAt: string;
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2937' },
};

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  row.height = 22;
}

export async function buildWorkbook(params: BuildWorkbookParams): Promise<ExcelJS.Workbook> {
  const { result, cost, companyName, thesis, model, startedAt } = params;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Strattam Expert Interview Sourcer';
  workbook.created = new Date();

  const bucketNameById = new Map(result.buckets.map((b) => [b.id, b.name]));
  const questionTextById = new Map(result.diligenceQuestions.map((q) => [q.id, q.text]));

  // --- Candidates sheet -------------------------------------------------------------------
  const candidatesSheet = workbook.addWorksheet('Candidates');
  candidatesSheet.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Current Company / Title', key: 'currentCompanyTitle', width: 32 },
    { header: 'Former Company / Title', key: 'formerCompanyTitle', width: 32 },
    { header: 'Relationship to Target', key: 'relationshipToTarget', width: 24 },
    { header: 'Expertise Bucket', key: 'expertiseBucket', width: 24 },
    { header: 'Tier', key: 'tier', width: 10 },
    { header: 'Best Diligence Questions', key: 'bestDiligenceQuestions', width: 46 },
    { header: 'Reason for Inclusion', key: 'reasonForInclusion', width: 46 },
    { header: 'LinkedIn URL / Source', key: 'linkedinUrlOrSource', width: 40 },
    { header: 'Confidence Score', key: 'confidenceScore', width: 16 },
    { header: 'Compliance Notes', key: 'complianceNotes', width: 36 },
  ];
  styleHeaderRow(candidatesSheet.getRow(1));

  const sortedCandidates = [...result.candidates].sort((a, b) => b.confidenceScore - a.confidenceScore);
  for (const c of sortedCandidates) {
    candidatesSheet.addRow({
      name: c.name + (c.outsideTheBox ? ' (outside-the-box)' : ''),
      currentCompanyTitle: c.currentCompany || c.currentTitle ? `${c.currentTitle ?? ''} - ${c.currentCompany ?? ''}` : '',
      formerCompanyTitle: c.formerCompany || c.formerTitle ? `${c.formerTitle ?? ''} - ${c.formerCompany ?? ''}` : '',
      relationshipToTarget: c.relationshipToTarget,
      expertiseBucket: bucketNameById.get(c.expertiseBucketId) ?? c.expertiseBucketId,
      tier: c.tier,
      bestDiligenceQuestions: c.bestDiligenceQuestionIds
        .map((id) => questionTextById.get(id) ?? id)
        .join('\n'),
      reasonForInclusion: c.reasonForInclusion,
      linkedinUrlOrSource: c.linkedinUrl || c.biographySource,
      confidenceScore: c.confidenceScore,
      complianceNotes: c.complianceNotes ?? '',
    });
  }
  candidatesSheet.getColumn('bestDiligenceQuestions').alignment = { wrapText: true, vertical: 'top' };
  candidatesSheet.getColumn('reasonForInclusion').alignment = { wrapText: true, vertical: 'top' };
  candidatesSheet.autoFilter = { from: 'A1', to: 'K1' };

  // --- Company Profile sheet --------------------------------------------------------------
  const profileSheet = workbook.addWorksheet('Company Profile');
  profileSheet.columns = [
    { header: 'Field', key: 'field', width: 26 },
    { header: 'Value', key: 'value', width: 90 },
  ];
  styleHeaderRow(profileSheet.getRow(1));

  const p = result.companyProfile;
  const listField = (arr: string[]) => arr.join('; ');
  profileSheet.addRows([
    { field: 'Company Name', value: p.companyName },
    { field: 'Industry', value: p.industry },
    { field: 'Business Model', value: p.businessModel },
    { field: 'Revenue Drivers', value: listField(p.revenueDrivers) },
    { field: 'Cost Structure', value: listField(p.costStructure) },
    { field: 'Customers', value: listField(p.customers) },
    { field: 'Distribution Channels', value: listField(p.distributionChannels) },
    { field: 'Geographic Footprint', value: listField(p.geographicFootprint) },
    { field: 'Competitors', value: listField(p.competitors) },
    { field: 'Suppliers', value: listField(p.suppliers) },
    { field: 'Regulatory Considerations', value: listField(p.regulatoryConsiderations) },
    { field: 'Technology Stack', value: listField(p.technologyStack) },
    { field: 'Value Drivers', value: listField(p.valueDrivers) },
  ]);
  profileSheet.getColumn('value').alignment = { wrapText: true, vertical: 'top' };

  profileSheet.addRow({});
  const sourcesHeaderRow = profileSheet.addRow({ field: 'Sources', value: '' });
  sourcesHeaderRow.font = { bold: true };
  for (const s of p.sources) {
    profileSheet.addRow({ field: s.label, value: s.url });
  }

  // --- Coverage sheet ----------------------------------------------------------------------
  const coverageSheet = workbook.addWorksheet('Coverage');
  coverageSheet.addRow(['Overall Coverage Score', result.coverage.overallScore]);
  coverageSheet.addRow(['Buckets Covered', `${result.coverage.bucketsCovered} / ${result.coverage.bucketsTotal}`]);
  coverageSheet.addRow([]);
  const gapsHeader = coverageSheet.addRow(['Topic', 'Bucket', 'Severity', 'Note']);
  styleHeaderRow(gapsHeader);
  coverageSheet.columns = [
    { key: 'a', width: 28 },
    { key: 'b', width: 28 },
    { key: 'c', width: 12 },
    { key: 'd', width: 70 },
  ];
  for (const gap of result.coverage.gaps) {
    coverageSheet.addRow([gap.topic, bucketNameById.get(gap.bucketId ?? '') ?? gap.bucketId ?? '', gap.severity, gap.note]);
  }
  coverageSheet.addRow([]);
  coverageSheet.addRow(['Compliance Summary']);
  coverageSheet.addRow(['Hard-removed (current target employees/board members)', result.complianceSummary.hardRemovedCount]);
  coverageSheet.addRow(['Flagged (current competitor employees)', result.complianceSummary.flaggedCompetitorCount]);

  // --- Run Info sheet ----------------------------------------------------------------------
  const runInfoSheet = workbook.addWorksheet('Run Info');
  runInfoSheet.columns = [
    { header: 'Field', key: 'field', width: 28 },
    { header: 'Value', key: 'value', width: 70 },
  ];
  styleHeaderRow(runInfoSheet.getRow(1));
  runInfoSheet.addRows([
    { field: 'Company', value: companyName },
    { field: 'Investment Thesis', value: thesis ?? '(none provided)' },
    { field: 'Model', value: model },
    { field: 'Run Started', value: startedAt },
    { field: 'Generated', value: new Date().toISOString() },
  ]);

  if (cost) {
    runInfoSheet.addRow({});
    const costHeader = runInfoSheet.addRow({ field: 'Cost Breakdown', value: '' });
    costHeader.font = { bold: true };
    for (const entry of cost.breakdown) {
      runInfoSheet.addRow({ field: `${entry.label} [${entry.basis}]`, value: `$${entry.usd.toFixed(2)}` });
    }
    runInfoSheet.addRow({ field: 'Total (Claude exact + Firecrawl/PDL estimated)', value: `$${cost.totalUsd.toFixed(2)}` });
  }

  return workbook;
}

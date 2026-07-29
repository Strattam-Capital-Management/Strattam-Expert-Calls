// Shared TypeScript types. These mirror the API contract exactly (see project README /
// build brief) so the frontend, built in a sibling repo against the same contract, can
// deserialize responses without surprises.

export interface SourceCitation {
  label: string;
  url: string;
}

export interface CompanyProfile {
  companyName: string;
  industry: string;
  businessModel: string;
  revenueDrivers: string[];
  costStructure: string[];
  customers: string[];
  distributionChannels: string[];
  geographicFootprint: string[];
  competitors: string[];
  suppliers: string[];
  regulatoryConsiderations: string[];
  technologyStack: string[];
  valueDrivers: string[];
  sources: SourceCitation[];
}

export interface Bucket {
  id: string;
  name: string;
  rationale: string;
}

export interface Archetype {
  bucketId: string;
  title: string;
  whyValuable: string;
}

export interface DiligenceQuestion {
  id: string;
  text: string;
  topics: string[];
}

export type RelationshipToTarget =
  | 'former_employee'
  | 'current_competitor_employee'
  | 'former_competitor_employee'
  | 'former_supplier'
  | 'current_customer'
  | 'former_customer'
  | 'other';

export type Tier = 'Tier 1' | 'Tier 2' | 'Tier 3';

export interface Candidate {
  id: string;
  name: string;
  currentCompany?: string;
  currentTitle?: string;
  formerCompany?: string;
  formerTitle?: string;
  relevantRole: string;
  relationshipToTarget: RelationshipToTarget;
  expertiseBucketId: string;
  tenureNote?: string;
  linkedinUrl?: string;
  biographySource: string;
  bestDiligenceQuestionIds: string[];
  reasonForInclusion: string;
  confidenceScore: number;
  tier: Tier;
  outsideTheBox: boolean;
  complianceNotes?: string;
}

// --- Internal pipeline intermediate shapes -------------------------------------------------
// Candidates are built up incrementally through the pipeline: sourced -> compliance-filtered ->
// scored -> question-mapped -> tiered. Each stage adds fields until the shape matches Candidate.

export type CandidateDraft = Omit<
  Candidate,
  'confidenceScore' | 'tier' | 'bestDiligenceQuestionIds' | 'reasonForInclusion'
>;

export type CandidateScored = CandidateDraft & { confidenceScore: number };

export type CandidateMapped = CandidateScored & {
  bestDiligenceQuestionIds: string[];
  reasonForInclusion: string;
};

export interface CoverageGap {
  topic: string;
  bucketId?: string;
  severity: 'high' | 'medium' | 'low';
  note: string;
}

export interface CoverageReport {
  overallScore: number;
  bucketsCovered: number;
  bucketsTotal: number;
  gaps: CoverageGap[];
}

export interface ComplianceSummary {
  hardRemovedCount: number;
  flaggedCompetitorCount: number;
}

export interface RunResult {
  companyProfile: CompanyProfile;
  buckets: Bucket[];
  archetypes: Archetype[];
  diligenceQuestions: DiligenceQuestion[];
  candidates: Candidate[];
  coverage: CoverageReport;
  complianceSummary: ComplianceSummary;
}

export interface CostBreakdownEntry {
  label: string;
  usd: number;
  basis: 'exact' | 'estimated';
}

export interface CostSummary {
  claudeUsd: number;
  firecrawlUsd: number;
  pdlUsd: number;
  totalUsd: number;
  breakdown: CostBreakdownEntry[];
}

export type RunStatus = 'running' | 'completed' | 'error';

export interface RunStartRequest {
  companyName: string;
  companyHint?: string;
  thesis?: string;
  diligenceQuestions?: DiligenceQuestion[];
  model: string;
}

export interface RunStatusResponse {
  runId: string;
  status: RunStatus;
  stage: string;
  error?: string;
  result?: RunResult;
  cost?: CostSummary;
}

export interface CompanyDisambiguationCandidate {
  name: string;
  domain: string;
  oneLiner: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  blurb: string;
  inputPerM: number;
  outputPerM: number;
}

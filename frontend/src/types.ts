// ---------------------------------------------------------------------------
// Core RunResult shapes — must match the backend contract exactly.
// ---------------------------------------------------------------------------

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
  sources: { label: string; url: string }[];
}

export interface ExpertiseBucket {
  id: string;
  name: string;
  rationale: string;
}

export interface CandidateArchetype {
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
  | "former_employee"
  | "current_competitor_employee"
  | "former_competitor_employee"
  | "former_supplier"
  | "current_customer"
  | "former_customer"
  | "other";

export type Tier = "Tier 1" | "Tier 2" | "Tier 3";

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

export interface CoverageGap {
  topic: string;
  bucketId?: string;
  severity: "high" | "medium" | "low";
  note: string;
}

export interface Coverage {
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
  buckets: ExpertiseBucket[];
  archetypes: CandidateArchetype[];
  diligenceQuestions: DiligenceQuestion[];
  candidates: Candidate[];
  coverage: Coverage;
  complianceSummary: ComplianceSummary;
}

export interface CostSummary {
  claudeUsd: number;
  firecrawlUsd: number;
  pdlUsd: number;
  totalUsd: number;
  breakdown: { label: string; usd: number; basis: "exact" | "estimated" }[];
}

// ---------------------------------------------------------------------------
// Supporting API request/response shapes (not part of RunResult, but needed
// to type the rest of the API surface described in the contract).
// ---------------------------------------------------------------------------

export interface AuthCheckResponse {
  ok: boolean;
  authRequired: boolean;
}

export interface DisambiguationCandidate {
  name: string;
  domain: string;
  oneLiner: string;
}

export interface DisambiguationResponse {
  candidates: DisambiguationCandidate[];
}

export interface DefaultQuestionsResponse {
  questions: DiligenceQuestion[];
}

export interface ModelInfo {
  id: string;
  label: string;
  blurb: string;
  inputPerM: number;
  outputPerM: number;
}

export interface ModelsResponse {
  models: ModelInfo[];
}

export interface CostEstimate {
  model: string;
  estimatedLowUsd: number;
  estimatedHighUsd: number;
  note: string;
}

export interface StartRunPayload {
  companyName: string;
  companyHint?: string;
  thesis?: string;
  diligenceQuestions?: DiligenceQuestion[];
  model: string;
}

export interface StartRunResponse {
  runId: string;
}

export type RunStatus = "running" | "completed" | "error";

export interface RunStatusResponse {
  runId: string;
  status: RunStatus;
  stage: string;
  error?: string;
  result?: RunResult;
  cost?: CostSummary;
}

export interface CacheStatsResponse {
  cachedCompanies: number;
  totalRuns: number;
}

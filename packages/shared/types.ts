import type { ProviderEnvKeyName } from './constants';

export type Provider = 'openai' | 'anthropic' | 'gemini';

export interface JudgeSpec {
  provider: Provider;
  model: string;
}

export interface RubricCriterion {
  criterionId: string;
  criterion: string;
  description: string;
  maxPoints: number;
  weight: number;
}

export interface Rubric {
  criteria: RubricCriterion[];
  totalMax: number;
}

export interface ResumeText {
  applicantName: string;
  resumeFilename: string;
  sourcePath: string;
  text: string;
  warnings: string[];
}

export interface CriterionJudgeScore {
  score: number;
  rationale: string;
}

export interface JudgeRawOutput {
  scores: Record<string, CriterionJudgeScore>;
  overall_rationale: string;
}

export interface ResumeJudgeResult {
  judge: JudgeSpec;
  applicantName: string;
  resumeFilename: string;
  criterionScores: Record<string, number>;
  criterionRationales: Record<string, string>;
  overallRationale: string;
  finalScore: number;
  warnings: string[];
}

export interface RunAllJudgesResult {
  byJudge: Array<{
    judge: JudgeSpec;
    results: ResumeJudgeResult[];
  }>;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type JobProgressPhase = 'extract' | 'judge' | 'excel' | 'upload';

export interface JobProgress {
  phase: JobProgressPhase;
  pct: number;
  message: string;
}

export interface JobResult {
  downloadUrl: string;
}

export interface JobError {
  message: string;
  stack?: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  progress: JobProgress;
  result: JobResult | null;
  error: JobError | null;
}

export interface CreateJobPayload {
  jobId: string;
  notes?: string;
  judges: JudgeSpec[];
  apiKeys: Partial<Record<ProviderEnvKeyName, string>>;
}

export interface ParsedRubricRow {
  criterion: string;
  description?: string;
  max_points: number;
  weight?: number;
}

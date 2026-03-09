import type { Provider } from './types';

export const PROVIDER_ENV_KEY = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY'
} as const satisfies Record<Provider, string>;
export type ProviderEnvKeyName = (typeof PROVIDER_ENV_KEY)[Provider];

export const JOB_QUEUE_NAME = 'resume-judge-jobs';
export const JOB_REDIS_KEY_PREFIX = 'resume-judge:job:';
export const JOB_FILES_REDIS_KEY_PREFIX = 'resume-judge:files:';
export const RATE_LIMIT_REDIS_KEY_PREFIX = 'resume-judge:ratelimit:';
export const JOB_STATUS_TTL_SECONDS = 60 * 60 * 24;

export const MAX_RESUMES_ZIP_BYTES = 25 * 1024 * 1024;
export const MAX_RUBRIC_XLSX_BYTES = 2 * 1024 * 1024;
export const MAX_SINGLE_EXTRACTED_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_UNCOMPRESSED_RESUME_BYTES = 50 * 1024 * 1024;
export const MAX_RESUMES_PER_JOB = 100;
export const MAX_RUBRIC_CRITERIA = 100;
export const MAX_RESUME_TEXT_CHARS = 50_000;
export const MAX_NOTES_CHARS = 4_000;
export const MAX_JUDGES = 5;
export const MAX_MODEL_LENGTH = 120;

export const JOB_ACCESS_TOKEN_HEADER = 'x-job-token';

export const SUBMIT_RATE_LIMIT_MAX = 10;
export const SUBMIT_RATE_LIMIT_WINDOW_SECONDS = 60;
export const STATUS_RATE_LIMIT_MAX = 240;
export const STATUS_RATE_LIMIT_WINDOW_SECONDS = 60;
export const DOWNLOAD_RATE_LIMIT_MAX = 30;
export const DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS = 60;

export const SUPPORTED_RESUME_EXTENSIONS = ['.pdf', '.txt'] as const;

export const JUDGE_JSON_SCHEMA_HINT = `{
  "scores": {
    "<criterion_id>": {
      "score": number,
      "rationale": string
    }
  },
  "overall_rationale": string
}`;

export const PROMPT_TEMPLATE = `You are a strict resume evaluator.

Return ONLY valid JSON, no markdown, no commentary.
The JSON must match this shape exactly:
{{SCHEMA_HINT}}

Rules:
- Include a \"scores\" object key for every rubric criterion_id.
- Each score must be numeric and between 0 and that criterion's max_points.
- Use concise rationales tied to resume evidence.
- If evidence is missing, score lower and explain briefly.
`;

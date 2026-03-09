import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { JOB_FILES_REDIS_KEY_PREFIX, JOB_QUEUE_NAME, JOB_REDIS_KEY_PREFIX, JOB_STATUS_TTL_SECONDS } from '@shared/constants';
import { hashJobAccessToken, safeEqualTokenHash } from '@shared/security';
import type {
  CreateJobPayload,
  JobError,
  JobProgress,
  JobStatus,
  JobStatusResponse
} from '@shared/types';

let redisClient: IORedis | null = null;
let queueInstance: Queue | null = null;

function getRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is required to run queue and job status APIs.');
  }
  return redisUrl;
}

export function getRedisConnection(): IORedis {
  if (!redisClient) {
    redisClient = new IORedis(getRedisUrl(), {
      maxRetriesPerRequest: null
    });
    redisClient.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });
  }

  return redisClient;
}

export function getQueue(): Queue {
  if (!queueInstance) {
    queueInstance = new Queue(JOB_QUEUE_NAME, {
      connection: getRedisConnection() as never,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 100
      }
    });
  }

  return queueInstance;
}

function jobKey(jobId: string): string {
  return `${JOB_REDIS_KEY_PREFIX}${jobId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePct(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export async function initJobStatus(jobId: string, accessTokenHash: string): Promise<void> {
  const redis = getRedisConnection();
  const progress: JobProgress = {
    phase: 'extract',
    pct: 0,
    message: 'Queued'
  };

  await redis.hset(jobKey(jobId), {
    jobId,
    status: 'queued',
    access_token_hash: accessTokenHash,
    progress_phase: progress.phase,
    progress_pct: String(progress.pct),
    progress_message: progress.message,
    result_ready: '0',
    error_message: '',
    error_stack: '',
    created_at: nowIso(),
    updated_at: nowIso()
  });
  await redis.expire(jobKey(jobId), JOB_STATUS_TTL_SECONDS);
}

export async function setJobStatus(args: {
  jobId: string;
  status?: JobStatus;
  progress?: JobProgress;
  resultReady?: boolean;
  error?: JobError | null;
}): Promise<void> {
  const redis = getRedisConnection();
  const updates: Record<string, string> = {
    updated_at: nowIso()
  };

  if (args.status) {
    updates.status = args.status;
  }

  if (args.progress) {
    updates.progress_phase = args.progress.phase;
    updates.progress_pct = String(normalizePct(args.progress.pct));
    updates.progress_message = args.progress.message;
  }

  if (args.resultReady) {
    updates.result_ready = '1';
  }

  if (args.error === null) {
    updates.error_message = '';
    updates.error_stack = '';
  }

  if (args.error) {
    updates.error_message = args.error.message;
    updates.error_stack = args.error.stack ?? '';
  }

  await redis.hset(jobKey(args.jobId), updates);
  await redis.expire(jobKey(args.jobId), JOB_STATUS_TTL_SECONDS);
}

export async function hasJobAccess(jobId: string, accessToken: string): Promise<boolean> {
  const redis = getRedisConnection();
  const storedHash = await redis.hget(jobKey(jobId), 'access_token_hash');

  if (!storedHash) {
    return false;
  }

  return safeEqualTokenHash(storedHash, hashJobAccessToken(accessToken));
}

export async function getJobStatus(jobId: string): Promise<(JobStatusResponse & { resultReady?: boolean }) | null> {
  const redis = getRedisConnection();
  const raw = await redis.hgetall(jobKey(jobId));

  if (!raw || Object.keys(raw).length === 0) {
    return null;
  }

  const pct = Number(raw.progress_pct ?? 0);
  const resultReady = raw.result_ready === '1';

  return {
    jobId,
    status: (raw.status as JobStatus) ?? 'queued',
    progress: {
      phase: (raw.progress_phase as JobProgress['phase']) ?? 'extract',
      pct: normalizePct(pct),
      message: raw.progress_message ?? ''
    },
    result: resultReady ? { downloadUrl: `/api/jobs/${jobId}/download` } : null,
    error: raw.error_message
      ? {
          message: raw.error_message
        }
      : null,
    resultReady
  };
}

// ---------------------------------------------------------------------------
// Job file storage (Redis-backed, shared between web and worker containers)
// ---------------------------------------------------------------------------

function fileKey(jobId: string, filename: string): string {
  return `${JOB_FILES_REDIS_KEY_PREFIX}${jobId}:${filename}`;
}

export async function storeJobFile(jobId: string, filename: string, data: Buffer): Promise<void> {
  const redis = getRedisConnection();
  const key = fileKey(jobId, filename);
  await redis.set(key, data, 'EX', JOB_STATUS_TTL_SECONDS);
}

export async function getJobFile(jobId: string, filename: string): Promise<Buffer | null> {
  const redis = getRedisConnection();
  const key = fileKey(jobId, filename);
  return redis.getBuffer(key);
}

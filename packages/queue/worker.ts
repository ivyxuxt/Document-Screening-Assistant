import { promises as fs } from 'fs';
import { Worker } from 'bullmq';
import path from 'path';

import { JOB_QUEUE_NAME } from '@shared/constants';
import type { CreateJobPayload, JobProgress } from '@shared/types';

import { getJobFile, getRedisConnection, setJobStatus, storeJobFile } from './queue';
import { parseRubricXlsx } from '@scoring/rubric/parseRubricXlsx';
import { unzipResumes } from '@scoring/resumes/unzipResumes';
import { extractTextFromResumeFiles } from '@scoring/resumes/extractText';
import { runAllJudges } from '@scoring/scoring/runAllJudges';
import { buildResultsWorkbook } from '@scoring/excel/buildResultsWorkbook';
import { ensureJobDirectories } from '@storage/localTempStorage';

async function setProgress(jobId: string, progress: JobProgress): Promise<void> {
  await setJobStatus({
    jobId,
    status: 'running',
    progress,
    error: null
  });
}

function errorToMessage(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: 'Unknown job processing error'
  };
}

export async function processJob(payload: CreateJobPayload): Promise<void> {
  const { jobId } = payload;

  await setProgress(jobId, {
    phase: 'extract',
    pct: 0.02,
    message: 'Preparing extraction'
  });

  const dirs = await ensureJobDirectories(jobId);

  // Pull uploaded files from Redis into local temp for processing
  const resumesZipBuffer = await getJobFile(jobId, 'resumes.zip');
  if (!resumesZipBuffer) throw new Error('Resume ZIP not found in storage.');
  const rubricXlsxBuffer = await getJobFile(jobId, 'rubric.xlsx');
  if (!rubricXlsxBuffer) throw new Error('Rubric XLSX not found in storage.');

  const resumesZipPath = path.join(dirs.uploadsDir, 'resumes.zip');
  const rubricXlsxPath = path.join(dirs.uploadsDir, 'rubric.xlsx');
  await fs.writeFile(resumesZipPath, resumesZipBuffer);
  await fs.writeFile(rubricXlsxPath, rubricXlsxBuffer);

  const resumesExtractDir = path.join(dirs.extractedDir, 'resumes');

  await setProgress(jobId, {
    phase: 'extract',
    pct: 0.06,
    message: 'Unzipping resumes'
  });

  const extractedFiles = await unzipResumes(resumesZipPath, resumesExtractDir);
  if (!extractedFiles.length) {
    throw new Error('No files found in resumes ZIP.');
  }

  const rubric = await parseRubricXlsx(rubricXlsxPath);

  const extractionResult = await extractTextFromResumeFiles(
    extractedFiles,
    async ({ done, total }) => {
      const ratio = total > 0 ? done / total : 1;
      await setProgress(jobId, {
        phase: 'extract',
        pct: 0.06 + ratio * 0.14,
        message: `Extracted text for ${done}/${total} files`
      });
    }
  );

  const resumes = extractionResult.resumes;

  if (!resumes.length) {
    const warningSuffix = extractionResult.warnings.length
      ? ` Warnings: ${extractionResult.warnings.map((w) => `${w.file}: ${w.message}`).join(' | ')}`
      : '';
    throw new Error(`No supported resumes found after extraction.${warningSuffix}`);
  }

  await setProgress(jobId, {
    phase: 'judge',
    pct: 0.2,
    message: 'Starting LLM evaluations'
  });

  const results = await runAllJudges({
    resumes,
    rubric,
    notes: payload.notes,
    judges: payload.judges,
    apiKeys: payload.apiKeys,
    onEvaluation: async ({ done, total, judge, resume }) => {
      const ratio = total > 0 ? done / total : 1;
      await setProgress(jobId, {
        phase: 'judge',
        pct: 0.2 + ratio * 0.7,
        message: `Evaluated ${resume.resumeFilename} with ${judge.provider}:${judge.model} (${done}/${total})`
      });
    }
  });

  await setProgress(jobId, {
    phase: 'excel',
    pct: 0.93,
    message: 'Building workbook'
  });

  await buildResultsWorkbook({
    results,
    rubric,
    outputPath: dirs.outputPath
  });

  await setProgress(jobId, {
    phase: 'upload',
    pct: 0.98,
    message: 'Finalizing result'
  });

  // Store result XLSX in Redis so the web service can serve it
  const resultBuffer = await fs.readFile(dirs.outputPath);
  await storeJobFile(jobId, 'results.xlsx', resultBuffer);

  await setJobStatus({
    jobId,
    status: 'succeeded',
    progress: {
      phase: 'upload',
      pct: 1,
      message: 'Completed'
    },
    resultReady: true,
    error: null
  });
}

export function startWorker(): Worker<CreateJobPayload> {
  return new Worker<CreateJobPayload>(
    JOB_QUEUE_NAME,
    async (job) => {
      await processJob(job.data);
    },
    {
      connection: getRedisConnection() as never,
      concurrency: Number(process.env.WORKER_CONCURRENCY || 2)
    }
  );
}

if (process.argv[1]?.includes('worker')) {
  const worker = startWorker();

  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed.`);
  });

  worker.on('failed', async (job, error) => {
    if (job?.data?.jobId) {
      await setJobStatus({
        jobId: job.data.jobId,
        status: 'failed',
        progress: {
          phase: 'upload',
          pct: 1,
          message: 'Failed'
        },
        error: errorToMessage(error)
      });
    }

    console.error(`Job ${job?.id ?? 'unknown'} failed:`, error);
  });

  process.on('SIGTERM', async () => {
    await worker.close();
    process.exit(0);
  });
}

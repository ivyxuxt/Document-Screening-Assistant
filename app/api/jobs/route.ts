import { randomUUID } from 'crypto';

import { NextResponse } from 'next/server';

import {
  MAX_RESUMES_ZIP_BYTES,
  MAX_RUBRIC_XLSX_BYTES,
  PROVIDER_ENV_KEY,
  type ProviderEnvKeyName,
  SUBMIT_RATE_LIMIT_MAX,
  SUBMIT_RATE_LIMIT_WINDOW_SECONDS
} from '@shared/constants';
import { apiKeysSchema, judgesSchema, notesSchema } from '@shared/schemas';
import { generateJobAccessToken, getRequestIp, hashJobAccessToken, isRateLimited } from '@shared/security';
import type { CreateJobPayload } from '@shared/types';

import { getQueue, getRedisConnection, initJobStatus, storeJobFile } from '@queue/queue';

export const runtime = 'nodejs';

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json(
    {
      error: { message },
      ...extra
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store'
      }
    }
  );
}

function parseJsonField<T>(label: string, value: FormDataEntryValue | null): T {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a JSON string.`);
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function assertUploadedFile(file: File, args: { label: string; expectedExtension: string; maxBytes: number }): void {
  const normalizedName = file.name.trim().toLowerCase();
  if (!normalizedName.endsWith(args.expectedExtension)) {
    throw new Error(`${args.label} must be a ${args.expectedExtension} file.`);
  }

  if (file.size <= 0) {
    throw new Error(`${args.label} must not be empty.`);
  }

  if (file.size > args.maxBytes) {
    throw new Error(`${args.label} exceeds the maximum allowed size.`);
  }
}

export async function POST(request: Request) {
  try {
    const redis = getRedisConnection();
    const clientIp = getRequestIp(request);
    const rateLimited = await isRateLimited({
      redis,
      bucket: 'submit',
      identifier: clientIp,
      limit: SUBMIT_RATE_LIMIT_MAX,
      windowSeconds: SUBMIT_RATE_LIMIT_WINDOW_SECONDS
    });

    if (rateLimited) {
      return jsonError('Too many job submissions. Please wait and try again.', 429);
    }

    const formData = await request.formData();

    const resumesZip = formData.get('resumesZip');
    const rubricXlsx = formData.get('rubricXlsx');
    const notes = formData.get('notes');
    const judgesRaw = formData.get('judges');
    const apiKeysRaw = formData.get('apiKeys');

    if (!(resumesZip instanceof File)) {
      return NextResponse.json({ error: { message: 'resumesZip file is required.' } }, { status: 400 });
    }

    if (!(rubricXlsx instanceof File)) {
      return jsonError('rubricXlsx file is required.', 400);
    }

    assertUploadedFile(resumesZip, {
      label: 'resumesZip',
      expectedExtension: '.zip',
      maxBytes: MAX_RESUMES_ZIP_BYTES
    });
    assertUploadedFile(rubricXlsx, {
      label: 'rubricXlsx',
      expectedExtension: '.xlsx',
      maxBytes: MAX_RUBRIC_XLSX_BYTES
    });

    const judgesParsed = parseJsonField<unknown>('judges', judgesRaw);
    const judges = judgesSchema.parse(judgesParsed);
    const sanitizedNotes = notesSchema.parse(typeof notes === 'string' ? notes : undefined);

    const providedApiKeys = apiKeysRaw
      ? apiKeysSchema.parse(parseJsonField<unknown>('apiKeys', apiKeysRaw))
      : {};
    const allowServerSideProviderKeys = process.env.ALLOW_SERVER_SIDE_PROVIDER_KEYS === 'true';

    const requiredKeys = Array.from(
      new Set(judges.map((judge) => PROVIDER_ENV_KEY[judge.provider]))
    ) as ProviderEnvKeyName[];

    const resolvedApiKeys: Partial<Record<ProviderEnvKeyName, string>> = {};
    const missingKeys: string[] = [];

    for (const keyName of requiredKeys) {
      const value = providedApiKeys[keyName] || (allowServerSideProviderKeys ? process.env[keyName] : undefined);
      if (value) {
        resolvedApiKeys[keyName] = value;
      } else {
        missingKeys.push(keyName);
      }
    }

    if (missingKeys.length > 0) {
      return jsonError(
        `Missing required API key(s): ${missingKeys.join(', ')}`,
        400,
        { requiredKeys }
      );
    }

    const jobId = randomUUID();
    const accessToken = generateJobAccessToken();

    const resumesBuffer = Buffer.from(await resumesZip.arrayBuffer());
    const rubricBuffer = Buffer.from(await rubricXlsx.arrayBuffer());
    await storeJobFile(jobId, 'resumes.zip', resumesBuffer);
    await storeJobFile(jobId, 'rubric.xlsx', rubricBuffer);

    await initJobStatus(jobId, hashJobAccessToken(accessToken));

    const payload: CreateJobPayload = {
      jobId,
      notes: sanitizedNotes,
      judges,
      apiKeys: resolvedApiKeys
    };

    await getQueue().add(jobId, payload, {
      jobId,
      attempts: 1
    });

    return NextResponse.json(
      {
        jobId,
        accessToken,
        requiredKeys
      },
      {
        headers: {
          'Cache-Control': 'no-store'
        }
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create job.';
    const status = /maximum allowed size/i.test(message) ? 413 : 400;
    return jsonError(message, status);
  }
}

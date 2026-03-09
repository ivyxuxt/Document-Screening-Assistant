import { NextResponse } from 'next/server';

import {
  DOWNLOAD_RATE_LIMIT_MAX,
  DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS
} from '@shared/constants';
import { getJobAccessTokenFromRequest, getRequestIp, isRateLimited, isUuid } from '@shared/security';

import { getJobFile, getJobStatus, getRedisConnection, hasJobAccess } from '@queue/queue';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  if (!isUuid(jobId)) {
    return NextResponse.json({ error: { message: 'Invalid job id.' } }, { status: 400 });
  }

  const accessToken = getJobAccessTokenFromRequest(request);
  if (!accessToken) {
    return NextResponse.json({ error: { message: 'Job not found.' } }, { status: 404 });
  }

  const redis = getRedisConnection();
  const rateLimited = await isRateLimited({
    redis,
    bucket: 'download',
    identifier: `${getRequestIp(request)}:${jobId}`,
    limit: DOWNLOAD_RATE_LIMIT_MAX,
    windowSeconds: DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS
  });

  if (rateLimited) {
    return NextResponse.json({ error: { message: 'Too many download requests.' } }, { status: 429 });
  }

  if (!(await hasJobAccess(jobId, accessToken))) {
    return NextResponse.json({ error: { message: 'Job not found.' } }, { status: 404 });
  }

  const jobStatus = await getJobStatus(jobId);

  if (!jobStatus) {
    return NextResponse.json({ error: { message: 'Job not found.' } }, { status: 404 });
  }

  if (jobStatus.status !== 'succeeded' || !jobStatus.resultReady) {
    return NextResponse.json(
      { error: { message: 'Result is not ready for download.' } },
      { status: 409 }
    );
  }

  const resultBuffer = await getJobFile(jobId, 'results.xlsx');
  if (!resultBuffer) {
    return NextResponse.json({ error: { message: 'Result file does not exist.' } }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(resultBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="resume-judge-${jobId}.xlsx"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

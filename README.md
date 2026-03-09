# Resume LLM Judge (Backend)

Production-oriented, one-day build backend for scoring resume batches with multiple LLM judges.

- Next.js App Router API (thin handlers)
- BullMQ + Redis background processing
- `/tmp` local temp storage for uploads/results
- Excel output with one sheet per judge (+ `Average` when multiple judges)
- Resume ZIP input supports `.pdf` and `.txt` files

## Folder Structure

```text
app/api
  jobs/
    route.ts
    [jobId]/route.ts
    [jobId]/download/route.ts

packages/
  shared/
    types.ts
    schemas.ts
    constants.ts
  scoring/
    rubric/parseRubricXlsx.ts
    resumes/unzipResumes.ts
    resumes/extractText.ts
    prompt/buildPrompt.ts
    judges/base.ts
    judges/openai.ts
    judges/anthropic.ts
    judges/gemini.ts
    scoring/runJudgeOnResume.ts
    scoring/runAllJudges.ts
    excel/buildResultsWorkbook.ts
  queue/
    queue.ts
    worker.ts
  storage/
    localTempStorage.ts
```

## Requirements

- Node.js 20+
- Redis (local or Railway)

## Redis Setup

This app requires Redis for two things:

- BullMQ background jobs
- job status storage

The only Redis-specific environment variable is:

```bash
REDIS_URL=redis://localhost:6379
```

Use any valid Redis connection string, including auth, TLS, or DB selection if needed:

```bash
redis://:password@host:6379/0
rediss://:password@host:6379/0
```

Notes:
- The API process and the worker process must use the same `REDIS_URL`.
- No other Redis host/port/password env vars are used by this codebase.
- A normal Redis instance is sufficient for local development.

### Install Redis Locally

Using Homebrew:

```bash
brew install redis
brew services start redis
```

Verify Redis is running:

```bash
redis-cli ping
```

Expected response:

```text
PONG
```

Using Docker instead:

```bash
docker run -d --name document-screening-redis -p 6379:6379 redis:7
```

## Environment

Create `.env` (or use Railway vars):

```bash
REDIS_URL=redis://localhost:6379

# Optional fallback provider keys
# Disabled by default for security. Only used if ALLOW_SERVER_SIDE_PROVIDER_KEYS=true.
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

# Optional
ALLOW_SERVER_SIDE_PROVIDER_KEYS=false
WORKER_CONCURRENCY=2
```

Notes:
- API keys are only required for providers selected in the job.
- No key persistence on disk.
- Keys are not logged by this service.
- Server-side provider key fallback is disabled by default in deployed environments.
- To let public job submissions use service-level provider keys, set `ALLOW_SERVER_SIDE_PROVIDER_KEYS=true`. This is higher risk because public users can spend your provider credits.
- `npm run dev` loads `.env` automatically through Next.js.
- `npm run worker` does not load `.env` automatically because it runs `tsx packages/queue/worker.ts`.

## Security Model

This app now enforces:

- per-job access tokens for polling and downloads
- Redis-backed rate limiting for submit, poll, and download endpoints
- upload size limits
- extracted archive size and file-count limits
- rubric, notes, judge-count, and model-name limits
- no stack traces in API responses

Important:
- `POST /api/jobs` returns an `accessToken`.
- The client must keep that token and send it when polling job status or downloading results.
- Anyone with both `jobId` and `accessToken` can access that job's status and output.

Current limits:
- resumes ZIP upload: 25 MB max
- rubric XLSX upload: 2 MB max
- extracted supported resume files: 100 max
- extracted size per resume file: 10 MB max
- total extracted resume bytes per job: 50 MB max
- rubric criteria: 100 max
- judges per job: 5 max
- notes: 4,000 characters max
- extracted resume text sent to model: 50,000 characters max per resume

## Install

```bash
npm install
```

## Run Locally

1. Start Redis and confirm `redis-cli ping` returns `PONG`.
2. Create `.env` with `REDIS_URL=redis://localhost:6379`.
3. Start the API.
4. Start the worker in a shell where `REDIS_URL` is exported.

Terminal 1 (API):

```bash
npm run dev
```

Terminal 2 (worker):

```bash
set -a
source .env
set +a
npm run worker
```

## Run Locally With Docker

This repo includes `Dockerfile` and `docker-compose.yml` for local Docker use on `localhost`.

1. Create `.env`.
2. Keep provider keys in `.env` if you want the containers to have defaults.
3. Start the stack:

```bash
docker compose up --build
```

This starts:
- `web` on `http://localhost:3000`
- `redis` on `localhost:6379`
- `worker` in a second container

Important:
- Inside Docker Compose, `REDIS_URL` is set to `redis://redis:6379`.
- On your host machine outside Docker, Redis remains reachable at `redis://localhost:6379`.
- The web container binds to `0.0.0.0:3000`, so the app is available at `http://localhost:3000`.
- The Docker image installs build-time dev dependencies because Next.js needs them during `npm run build`.

Useful commands:

```bash
docker compose up --build -d
docker compose logs -f web
docker compose logs -f worker
docker compose down
```

Alternative one-liner:

```bash
REDIS_URL=redis://localhost:6379 npm run worker
```

If you use provider API keys via `.env`, load them into the worker shell the same way:

```bash
set -a
source .env
set +a
npm run worker
```

## API Contract

### 1) `POST /api/jobs`

Multipart form-data fields:
- `resumesZip` (file, required). ZIP may contain `.pdf` and `.txt` resume files.
- `rubricXlsx` (file, required)
- `notes` (string, optional)
- `judges` (stringified JSON array, required), e.g. `[{"provider":"openai","model":"gpt-5.2"}]`
- `apiKeys` (stringified JSON object, optional), e.g. `{"OPENAI_API_KEY":"..."}`

Response:

```json
{
  "jobId": "<uuid>",
  "accessToken": "<secret-token>",
  "requiredKeys": ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]
}
```

### 2) `GET /api/jobs/:jobId`

Required auth:
- header: `x-job-token: <accessToken>`

Response:

```json
{
  "jobId": "<uuid>",
  "status": "queued|running|succeeded|failed",
  "progress": { "phase": "extract|judge|excel|upload", "pct": 0.0, "message": "..." },
  "result": { "downloadUrl": "/api/jobs/<uuid>/download" } | null,
  "error": { "message": "..." } | null
}
```

### 3) `GET /api/jobs/:jobId/download`

Required auth:
- query param: `?token=<accessToken>` or header `x-job-token: <accessToken>`

Streams generated XLSX with content type:
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

## Example: Submit Job

```bash
curl -X POST http://localhost:3000/api/jobs \
  -F "resumesZip=@./samples/resumes.zip" \
  -F "rubricXlsx=@./samples/rubric.xlsx" \
  -F 'notes=Prioritize backend systems design and production ownership.' \
  -F 'judges=[{"provider":"openai","model":"gpt-5.2"},{"provider":"anthropic","model":"claude-sonnet-4-5"}]' \
  -F 'apiKeys={"OPENAI_API_KEY":"'$OPENAI_API_KEY'","ANTHROPIC_API_KEY":"'$ANTHROPIC_API_KEY'"}'
```

Sample assets included in this repo:
- `samples/resumes.zip` - flat ZIP of `.txt` resume files
- `samples/resumes-pdf.zip` - flat ZIP of `.pdf` resume files
- `samples/rubric.xlsx` - example rubric workbook

Example response:

```json
{
  "jobId": "5f0c2c7b-3d63-46a4-9ff5-b0a79d7fd1c1",
  "accessToken": "<secret-token>",
  "requiredKeys": ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]
}
```

## Example: Poll Job

```bash
curl http://localhost:3000/api/jobs/<jobId> \
  -H "x-job-token: <accessToken>"
```

## Example: Download Result

```bash
curl -L "http://localhost:3000/api/jobs/<jobId>/download?token=<accessToken>" -o results.xlsx
```

## Scoring Pipeline

1. Upload saved under `/tmp/resume-judge/<jobId>/uploads`
2. Worker unzips resumes
3. Text extraction (`.pdf`, `.txt`; unsupported files skipped with warnings)
4. Rubric parse from `Rubric` sheet if present, else first sheet
5. For each `resume x judge`:
   - prompt model with rubric + notes + resume text
   - require strict JSON output
   - retry once with repair prompt if invalid JSON
   - validate JSON with Zod
   - compute weighted final score server-side (bounded)
6. Build workbook:
   - one sheet per judge
   - columns: `ApplicantName`, `ResumeFilename`, each rubric criterion, `FinalScore`
   - rows sorted by `FinalScore` descending
   - add `Average` sheet if >1 judge
7. Save output to `/tmp/resume-judge/<jobId>/results.xlsx`

## Rubric XLSX Format

Case-insensitive columns expected:
- `criterion` (required)
- `description` (optional)
- `max_points` (required, > 0)
- `weight` (optional, default `1`)

Internal `criterion_id` is generated as a stable slug.

## Deploy To Railway

This app should be deployed to Railway as two services from the same repo using the root `Dockerfile`:

- `web`: serves the Next.js UI and API
- `worker`: processes BullMQ jobs

Both services must share the same Redis instance and the same `REDIS_URL`.

### What Is Already Configured In This Repo

- `Dockerfile` builds a production image for Railway
- `docker-compose.yml` runs `web`, `worker`, and `redis` locally on Docker
- `.dockerignore` keeps the Docker build context clean
- `npm run start:web` starts the Next.js server
- `npm run start:worker` starts the BullMQ worker
- `app/health/route.ts` provides a Railway health endpoint

### Railway Architecture

Create one Railway project with:

1. A `web` service from this repo
2. A `worker` service from this repo
3. A Redis service

The `web` and `worker` services should both be connected to the same GitHub repo and branch.

### Web Service Settings

Set these in the Railway `web` service:

- Source: GitHub repo
- Builder: Dockerfile
- Dockerfile path: `Dockerfile`
- Start Command: leave blank to use the Dockerfile default, or set:

```bash
/bin/sh -lc 'npm run start:web -- --hostname 0.0.0.0 --port ${PORT:-3000}'
```

- Healthcheck path:

```text
/health
```

### Worker Service Settings

Set these in the Railway `worker` service:

- Source: GitHub repo
- Builder: Dockerfile
- Dockerfile path: `Dockerfile`
- Start Command:

```bash
npm run start:worker
```

The worker does not need a public domain.

### Redis Service

Add a Redis service in the same Railway project.

Then expose its connection string to both the `web` and `worker` services as:

```bash
REDIS_URL=<your-railway-redis-url>
```

Both services must use the same value.

### Required Environment Variables

Set these on both the `web` and `worker` services:

```bash
REDIS_URL=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
ALLOW_SERVER_SIDE_PROVIDER_KEYS=false
WORKER_CONCURRENCY=2
```

Notes:
- `REDIS_URL` is required.
- Provider API keys are only required for providers you actually use.
- If you send provider keys per job in the `POST /api/jobs` request, the service-level keys can be omitted.
- Keep `ALLOW_SERVER_SIDE_PROVIDER_KEYS=false` unless you explicitly want the server to spend its own provider credits on behalf of users.
- `WORKER_CONCURRENCY` only affects the worker service.

### Deploy Steps

1. Push this repo to GitHub.
2. In Railway, create a new project.
3. Add the `web` service from the GitHub repo.
4. Add a second service from the same GitHub repo and name it `worker`.
5. Add a Redis service.
6. Make sure both services use the root `Dockerfile`.
7. Set the start commands:
   - `web`: leave default or set `/bin/sh -lc 'npm run start:web -- --hostname 0.0.0.0 --port ${PORT:-3000}'`
   - `worker`: `npm run start:worker`
8. Set `REDIS_URL` on both services using the Redis service connection string.
9. Add any provider API keys you want available by default.
10. Deploy both services.
11. Open the `web` service domain and verify `/health` returns HTTP 200.

### Pre-Deploy Checklist

- `npm run typecheck` passes
- `npm run build` passes
- Docker image builds successfully
- Redis is attached and `REDIS_URL` is present on both services
- `web` and `worker` are on the same code branch
- the `worker` service is deployed and running before you submit jobs

### Operational Notes

- Uploaded files and generated XLSX files are written to `/tmp`, which is ephemeral. This is acceptable for the current flow because the result is expected to be downloaded shortly after processing.
- Resume archives should contain only `.pdf` and `.txt` files.
- If the `worker` service is down, jobs will remain queued in Redis and the UI will not progress.
- If `web` and `worker` do not share the same `REDIS_URL`, job status and queue processing will break.
- The worker process does not need inbound HTTP traffic.
- Polling and downloads require the per-job `accessToken` returned by `POST /api/jobs`.
- Job metadata in Redis expires automatically after 24 hours.
- The app rate-limits submit, poll, and download endpoints using Redis.

## Scripts

- `npm run dev` - start Next.js dev server
- `npm run build` - build app
- `npm run start` - start production server
- `npm run start:web` - Railway/web production start command
- `npm run start:worker` - Railway/worker start command
- `npm run worker` - start BullMQ worker
- `npm run typecheck` - TypeScript check

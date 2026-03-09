# Resume LLM Judge

Score resume batches with multiple LLM judges. Next.js frontend + API, BullMQ worker, Redis.

- Upload a ZIP of resumes (`.pdf` / `.txt`) and a rubric XLSX
- Pick one or more judges (OpenAI, Anthropic, Gemini)
- Download a scored Excel workbook when done

## Architecture

```
┌──────────┐       ┌───────────┐       ┌──────────┐
│   web    │──────▶│   Redis   │◀──────│  worker  │
│ (Next.js)│       │ (BullMQ + │       │ (BullMQ) │
│          │       │  files)   │       │          │
└──────────┘       └───────────┘       └──────────┘
```

- **web** serves the UI and API routes
- **worker** processes queued jobs (extract, score, build Excel)
- **Redis** stores job metadata, queued jobs, uploaded files, and results

Uploaded files and results are stored in Redis so web and worker don't need a shared filesystem. This is what makes Railway (and any multi-container setup) work.

## Requirements

- Node.js 20+
- Redis

## Environment

Create `.env`:

```bash
REDIS_URL=redis://localhost:6379

# Provider keys — only needed for providers you use
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

# Set to true to let jobs use server-side keys (default: false)
ALLOW_SERVER_SIDE_PROVIDER_KEYS=false

# Worker concurrency (default: 2)
WORKER_CONCURRENCY=2
```

## Run Locally

Terminal 1 (API):

```bash
npm run dev
```

Terminal 2 (worker):

```bash
source .env && npm run worker
```

## Run With Docker Compose

```bash
docker compose up --build
```

This starts `web` on `http://localhost:3000`, `worker`, and `redis`.

## Deploy To Railway

You need **3 services** in one Railway project:

| Service  | Source         | Start command                                                            |
| -------- | -------------- | ------------------------------------------------------------------------ |
| `web`    | GitHub repo    | `/bin/sh -lc 'npm run start:web -- --hostname 0.0.0.0 --port ${PORT:-3000}'` |
| `worker` | Same repo      | `npm run start:worker`                                                   |
| `redis`  | Railway add-on | —                                                                        |

### Step by step

1. Push this repo to GitHub.
2. In Railway, create a new project from your GitHub repo. Rename the service to `web`.
3. Set the `web` service builder to **Dockerfile** and add a healthcheck path: `/health`.
4. Create a second service from the same repo (`New → GitHub Repo → same repo`). Rename it to `worker`. Set builder to **Dockerfile** and set the start command to `npm run start:worker`. No public domain needed.
5. Add a **Redis** service (`New → Redis`).
6. Copy the Railway Redis connection string and set `REDIS_URL` on **both** `web` and `worker`.
7. Set provider API keys on both services (or let users supply them per-request).
8. Deploy both services.

### Verify

- `https://<web-domain>/health` should return `{ "ok": true, ... }`
- Submit a job through the UI and confirm it completes

### Troubleshooting

- **Jobs stay queued forever**: the `worker` service is not running.
- **`REDIS_URL is required`**: environment variable is missing on `web` or `worker`.
- **Don't use `redis://localhost:6379` on Railway** — that points to the container itself, not the Redis service.

## API

### `POST /api/jobs`

Multipart form-data:

| Field        | Type   | Required |
| ------------ | ------ | -------- |
| `resumesZip` | file   | yes      |
| `rubricXlsx` | file   | yes      |
| `notes`      | string | no       |
| `judges`     | JSON   | yes      |
| `apiKeys`    | JSON   | no       |

```json
// Response
{ "jobId": "<uuid>", "accessToken": "<token>", "requiredKeys": ["OPENAI_API_KEY"] }
```

### `GET /api/jobs/:jobId`

Header: `x-job-token: <accessToken>`

```json
{
  "jobId": "<uuid>",
  "status": "queued|running|succeeded|failed",
  "progress": { "phase": "extract|judge|excel|upload", "pct": 0.0, "message": "..." },
  "result": { "downloadUrl": "/api/jobs/<uuid>/download" },
  "error": null
}
```

### `GET /api/jobs/:jobId/download`

Header: `x-job-token: <accessToken>` (or query `?token=<accessToken>`)

Returns the scored XLSX file.

## Rubric XLSX Format

Columns (case-insensitive): `criterion` (required), `description` (optional), `max_points` (required, > 0), `weight` (optional, default 1).

## Scripts

| Command                | Description                       |
| ---------------------- | --------------------------------- |
| `npm run dev`          | Next.js dev server                |
| `npm run build`        | Production build                  |
| `npm run start:web`    | Start web server (production)     |
| `npm run start:worker` | Start BullMQ worker (production)  |
| `npm run worker`       | Start worker (development)        |
| `npm run typecheck`    | TypeScript check                  |

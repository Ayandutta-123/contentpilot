# ContentPilot

Multi-tenant social media automation. Brand, models, keys, and infrastructure are **environment-driven** — suitable for on-prem / server deploy without laptop hardcoding.

## Quick start (local)

```bash
cp .env.example .env
# Optional: machines without Docker Postgres
# USE_EMBEDDED_PG=true
# DATABASE_URL=postgresql://contentpilot:contentpilot@127.0.0.1:5433/contentpilot

npm install
npm run dev
```

- Web: `WEB_URL` (default `http://localhost:3000`)
- API: `API_URL` / `API_PORT` (default `4000`)

## Deploy (Docker / on-prem)

See **[DEPLOY.md](DEPLOY.md)** for persistence, reverse proxy, backups, and the production `.env` checklist.

```bash
cp .env.example .env
# Set NODE_ENV=production, WEB_URL, API_URL, POSTGRES_PASSWORD,
# SESSION_SECRET, ENCRYPTION_KEY, COOKIE_SECURE=true, TRUST_PROXY=true

docker compose up -d --build
```

Named volumes keep **Postgres**, **Redis**, and **uploads** across image rebuilds. Do not run `docker compose down -v` on production.

## Environment (flexible — not hardcoded)

| Variable | Purpose |
|----------|---------|
| `WEB_URL` / `API_URL` | Public URLs (**required** in production) |
| `CORS_ORIGINS` | Optional comma-separated browser origins |
| `INTERNAL_API_URL` | Next.js rewrite target inside Docker/K8s |
| `DATABASE_URL` | Postgres (required unless embedded) |
| `USE_EMBEDDED_PG` | Local-only embedded Postgres (`true`/`false`) |
| `REDIS_URL` | Optional; empty = inline jobs |
| `API_HOST` / `API_PORT` / `PORT` | Listen address |
| `UPLOAD_DIR` | Media root — Compose uses `/app/uploads` + volume |
| `SESSION_SECRET` / `ENCRYPTION_KEY` | Required secrets (keep encryption key stable) |
| `COOKIE_*` / `TRUST_PROXY` | Sessions behind TLS / reverse proxy |
| `APP_NAME` / `NEXT_PUBLIC_APP_*` | White-label product name |
| `LLM_*` / `FAL_*` / keys | Global fallbacks; prefer Settings → Integrations |

Full list: [`.env.example`](.env.example).

## Architecture

```
apps/api      Fastify + Prisma + BullMQ (Redis optional)
apps/web      Next.js UI (proxies /api → API)
packages/shared   Shared schemas + model catalogs
```

## Design rules

- **Zero product hardcoding** — company/product/topics live in DB + Settings
- **Zero infra hardcoding for deploy** — URLs, DB, Redis, cookies, uploads from env
- **Data survives redeploy** — Postgres + uploads volumes (see DEPLOY.md)
- **Approvals** — human-in-the-loop before publish

## License

Private — all rights reserved.

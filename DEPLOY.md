# On-prem / server deployment

ContentPilot is env-driven. Nothing should depend on a developer laptop path or `localhost` once you set production URLs.

## What survives a redeploy

| Data | Where | How it persists |
|------|--------|-----------------|
| Tenants, users, posts, settings, encrypted keys | PostgreSQL | Docker volume `postgres_data` |
| Job queues (optional) | Redis | Docker volume `redis_data` |
| Uploaded images / renders / logos | `UPLOAD_DIR` | Docker volume `uploads_data` → `/app/uploads` |
| Login sessions | Postgres `auth_sessions` | Same as DB volume |
| Provider API tokens in Settings | Postgres (encrypted) | Keep **`ENCRYPTION_KEY` unchanged** forever |

Rebuilding images (`docker compose up -d --build`) does **not** wipe those volumes. Deleting volumes (`docker compose down -v`) **does** wipe data — avoid `-v` on production.

## Quick start (server)

```bash
cp .env.example .env
# Edit .env — see checklist below
docker compose up -d --build
```

Open `WEB_URL`. API health: `API_URL/health` (or `/api/...` via the web reverse proxy).

## `.env` checklist (production)

```bash
NODE_ENV=production
USE_EMBEDDED_PG=false

# Public HTTPS URLs your users and Meta/Placid can reach
WEB_URL=https://content.yourcompany.com
API_URL=https://content.yourcompany.com   # or https://api.yourcompany.com

POSTGRES_PASSWORD=<strong unique password>
SESSION_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>     # never rotate casually

COOKIE_SECURE=true          # required with HTTPS
TRUST_PROXY=true            # required behind nginx/Caddy
COOKIE_SAME_SITE=lax
# COOKIE_DOMAIN=.yourcompany.com   # only if web+api on sibling hosts
```

Compose overrides `DATABASE_URL`, `REDIS_URL`, and `UPLOAD_DIR=/app/uploads` for the API container. You still set `WEB_URL` / `API_URL` / secrets / `POSTGRES_PASSWORD` in `.env`.

## Reverse proxy (example)

Terminate TLS at nginx/Caddy. Forward to:

- Web UI → `127.0.0.1:3000` (or `WEB_PORT`)
- If API is separate host → `127.0.0.1:4000`

Pass through `X-Forwarded-Proto` / `X-Forwarded-For` and keep `TRUST_PROXY=true`.

If web and API share one public origin (recommended), point the proxy at **web** only; Next rewrites `/api` and `/uploads` to the internal API service.

## Bare metal (no Docker)

1. Install Node 20+, PostgreSQL 16+, optional Redis.
2. Set `DATABASE_URL`, `UPLOAD_DIR=/var/lib/contentpilot/uploads`, `WEB_URL`, `API_URL`.
3. `npm install && npm run build` (workspaces).
4. Run API (`node apps/api/dist/index.js` or `tsx`) and web (`next start`).
5. Ensure `UPLOAD_DIR` and Postgres data directories are on persistent disks and backed up.

Do **not** use `USE_EMBEDDED_PG=true` on a shared server — embedded data under `./data/postgres` is easy to lose on redeploy.

## Instagram / Placid image URLs

External services must fetch images over **public HTTPS**.  
`API_URL` (or the public origin that serves `/uploads`) cannot be `localhost` or a private RFC1918 address unless you use a tunnel / public CDN.

## Backup

```bash
# Postgres
docker compose exec postgres pg_dump -U contentpilot contentpilot > backup.sql

# Uploads volume
docker run --rm -v contentpilot_uploads_data:/data -v "$(pwd)":/backup alpine \
  tar czf /backup/uploads-backup.tgz -C /data .
```

(Volume name may include the Compose project prefix — check `docker volume ls`.)

## After updating the app

```bash
git pull
docker compose up -d --build
```

Volumes keep DB + uploads. If you change `INTERNAL_API_URL` / API service name, rebuild the **web** image (rewrites are baked at build time).

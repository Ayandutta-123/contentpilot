import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';

// Load root .env then app .env (later files do not override existing)
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

/** Parse env booleans correctly ("false" → false). z.coerce.boolean treats "false" as true. */
const envBool = (defaultValue: boolean) =>
  z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return defaultValue;
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'off'].includes(s)) return false;
    return defaultValue;
  }, z.boolean());

const isProd = (process.env.NODE_ENV || 'development') === 'production';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Networking — use PORT if the host platform sets it (Railway, Render, Fly, etc.)
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().default(4000),

  // Public URLs (required in production — no localhost hardcoding for deploy)
  WEB_URL: isProd
    ? z.string().url()
    : z.string().default('http://localhost:3000'),
  API_URL: isProd
    ? z.string().url()
    : z.string().default('http://localhost:4000'),
  /** Comma-separated browser origins allowed for CORS; defaults to WEB_URL */
  CORS_ORIGINS: z.string().optional(),

  // Database — required unless embedded PG is explicitly enabled
  DATABASE_URL: z.string().min(1).optional(),
  USE_EMBEDDED_PG: envBool(false),
  EMBEDDED_PG_PORT: z.coerce.number().default(5433),
  EMBEDDED_PG_USER: z.string().default('contentpilot'),
  EMBEDDED_PG_PASSWORD: z.string().default('contentpilot'),
  EMBEDDED_PG_DATABASE: z.string().default('contentpilot'),
  EMBEDDED_PG_DATA_DIR: z.string().optional(),

  // Redis — empty / unset = inline job runner (no Redis required)
  REDIS_URL: z.string().optional(),

  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
  /** Default 30 days — keep users signed in across restarts */
  SESSION_MAX_AGE_MS: z.coerce.number().default(30 * 24 * 60 * 60 * 1000),
  COOKIE_SECURE: envBool(isProd),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),
  TRUST_PROXY: envBool(isProd),
  COOKIE_NAME: z.string().default('contentpilot.sid'),

  APP_NAME: z.string().default('ContentPilot'),
  APP_TAGLINE: z.string().default('Content Engine'),

  LLM_PROVIDER: z.enum(['openai', 'claude']).default('openai'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Workspace ID for identity-linked Anthropic keys (header anthropic-workspace-id) */
  ANTHROPIC_WORKSPACE_ID: z.string().optional(),
  LLM_MODEL: z.string().default('gpt-4o'),
  LLM_MAX_TOKENS: z.coerce.number().default(4096),

  IMAGE_PROVIDER: z.enum(['fal', 'openai']).default('fal'),
  /** Pro tier — markedly better composition/detail than flux/dev for brand creative. */
  FAL_MODEL: z.string().default('fal-ai/flux-pro/v1.1'),
  FAL_API_KEY: z.string().optional(),

  SEARCH_PROVIDER: z.enum(['tavily', 'serpapi']).default('tavily'),
  TAVILY_API_KEY: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),

  SCRAPING_PROVIDER: z.enum(['apify']).default('apify'),
  APIFY_API_TOKEN: z.string().optional(),

  NOTIFICATION_PROVIDER: z.enum(['slack', 'teams', 'email']).default('slack'),
  SLACK_WEBHOOK_URL: z.string().optional(),
  TEAMS_WEBHOOK_URL: z.string().optional(),
  /** Resend API key (preferred for email alerts). Falls back to SMTP_* if unset. */
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** From address — use a verified Resend domain, or beth.t@example.com for free tests */
  NOTIFICATION_FROM_EMAIL: z.string().optional(),
  /** Default alert recipient when Settings alert email is empty */
  NOTIFICATION_TO_EMAIL: z.string().optional(),

  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  /** Optional paid template API — in-house renderer is free and default */
  PLACID_API_KEY: z.string().optional(),

  MEDIA_STORAGE: z.enum(['local']).default('local'),
  MEDIA_SIGNED_URL_TTL_SECONDS: z.coerce.number().default(3600),
  /**
   * Absolute or relative path for uploaded media.
   * Docker Compose: set UPLOAD_DIR=/app/uploads (must match the volume mount).
   * Bare metal / on-prem: e.g. /var/lib/contentpilot/uploads
   */
  UPLOAD_DIR: z.string().default(''),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(300),

  MAX_REVISION_CYCLES: z.coerce.number().default(5),
  PUBLISH_POLL_INTERVAL_MS: z.coerce.number().default(5000),
  PUBLISH_POLL_MAX_ATTEMPTS: z.coerce.number().default(6),
});

function loadConfig() {
  const env = {
    ...process.env,
    // Cloud platforms often inject PORT
    API_PORT: process.env.API_PORT || process.env.PORT || '4000',
  };

  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    console.error('Invalid configuration:', parsed.error.flatten().fieldErrors);
    throw new Error('Configuration validation failed — check .env / environment variables');
  }

  const data = parsed.data;

  if (!data.USE_EMBEDDED_PG && !data.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required when USE_EMBEDDED_PG is false. Set DATABASE_URL in .env for deploy, or USE_EMBEDDED_PG=true for local-only embedded Postgres.',
    );
  }

  if (data.USE_EMBEDDED_PG && data.NODE_ENV === 'production') {
    console.warn(
      '[config] USE_EMBEDDED_PG=true in production is not recommended. Use a managed PostgreSQL DATABASE_URL instead.',
    );
  }

  if (data.COOKIE_SAME_SITE === 'none' && !data.COOKIE_SECURE) {
    throw new Error(
      'COOKIE_SAME_SITE=none requires COOKIE_SECURE=true (browsers reject insecure cross-site cookies).',
    );
  }

  if (data.NODE_ENV === 'production') {
    if (/localhost|127\.0\.0\.1/i.test(data.WEB_URL) || /localhost|127\.0\.0\.1/i.test(data.API_URL)) {
      console.warn(
        '[config] WEB_URL / API_URL still point at localhost in production. Set your real public HTTPS URLs for on-prem / server deploy.',
      );
    }
    if (!data.COOKIE_SECURE && /^https:/i.test(data.WEB_URL)) {
      console.warn(
        '[config] WEB_URL is HTTPS but COOKIE_SECURE=false — logins may fail. Set COOKIE_SECURE=true behind TLS.',
      );
    }
  }

  // Ensure DATABASE_URL is always present for Prisma after embedded may set it later
  if (data.DATABASE_URL) {
    process.env.DATABASE_URL = data.DATABASE_URL;
  }

  const uploadDir = resolveUploadDir(data.UPLOAD_DIR);
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch (err) {
    console.warn('[config] Could not create UPLOAD_DIR', uploadDir, err);
  }

  return {
    ...data,
    UPLOAD_DIR: uploadDir,
    DATABASE_URL: data.DATABASE_URL || '',
    REDIS_URL: data.REDIS_URL || '',
    corsOrigins: parseCorsOrigins(data.CORS_ORIGINS || data.WEB_URL),
  };
}

/**
 * Resolve where uploaded media lives. Prefer explicit UPLOAD_DIR; otherwise
 * Docker `/app/uploads`, monorepo `uploads/`, or legacy `apps/api/uploads`.
 */
function resolveUploadDir(configured: string): string {
  if (configured.trim()) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }
  return resolveDefaultUploadDir();
}

/**
 * Prefer Docker mount `/app/uploads`, then monorepo-root `uploads/`.
 * If monorepo is empty but legacy `apps/api/uploads` has files, keep serving those.
 */
function resolveDefaultUploadDir(): string {
  const dockerMount = '/app/uploads';
  try {
    if (process.cwd() === '/app' || fs.existsSync('/.dockerenv') || fs.existsSync(dockerMount)) {
      fs.mkdirSync(dockerMount, { recursive: true });
      return dockerMount;
    }
  } catch {
    /* ignore */
  }

  const monorepo = path.resolve(__dirname, '../../../../uploads');
  const legacyApi = path.resolve(__dirname, '../../uploads');
  try {
    const monoEmpty =
      !fs.existsSync(monorepo) || fs.readdirSync(monorepo).length === 0;
    const legacyHas =
      fs.existsSync(legacyApi) && fs.readdirSync(legacyApi).length > 0;
    if (monoEmpty && legacyHas) return legacyApi;
  } catch {
    /* ignore */
  }
  try {
    fs.mkdirSync(monorepo, { recursive: true });
  } catch {
    /* ignore */
  }
  return monorepo;
}

function parseCorsOrigins(value: string): boolean | string | string[] {
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return true;
  if (parts.length === 1) return parts[0];
  return parts;
}

export const config = loadConfig();
export type Config = typeof config;

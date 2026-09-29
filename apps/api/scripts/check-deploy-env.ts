/**
 * Quick sanity check that production-oriented env keys resolve without
 * hardcoded localhost when NODE_ENV=production (dry-run).
 *
 *   NODE_ENV=production WEB_URL=https://app.example.com API_URL=https://api.example.com \
 *   DATABASE_URL=postgresql://u:p@db:5432/cp SESSION_SECRET=… ENCRYPTION_KEY=… \
 *   node --import tsx apps/api/scripts/check-deploy-env.ts
 */
import path from 'path';
import fs from 'fs';

const requiredProd = [
  'WEB_URL',
  'API_URL',
  'DATABASE_URL',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
] as const;

function main() {
  const isProd = (process.env.NODE_ENV || '') === 'production';
  const missing = requiredProd.filter((k) => !String(process.env[k] || '').trim());
  if (isProd && missing.length) {
    console.error('MISSING', missing.join(', '));
    process.exit(1);
  }

  for (const key of ['WEB_URL', 'API_URL'] as const) {
    const v = process.env[key] || '';
    if (isProd && /localhost|127\.0\.0\.1/i.test(v)) {
      console.error(`${key} must not be localhost in production: ${v}`);
      process.exit(1);
    }
  }

  if (process.env.COOKIE_SAME_SITE === 'none' && process.env.COOKIE_SECURE === 'false') {
    console.error('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true');
    process.exit(1);
  }

  const upload = process.env.UPLOAD_DIR || '';
  console.log(
    JSON.stringify(
      {
        ok: true,
        NODE_ENV: process.env.NODE_ENV,
        WEB_URL: process.env.WEB_URL,
        API_URL: process.env.API_URL,
        UPLOAD_DIR: upload || '(default resolver)',
        TRUST_PROXY: process.env.TRUST_PROXY,
        COOKIE_SECURE: process.env.COOKIE_SECURE,
        examplePath: path.resolve('.env.example'),
        exampleExists: fs.existsSync(path.resolve('.env.example')),
      },
      null,
      2,
    ),
  );
}

main();

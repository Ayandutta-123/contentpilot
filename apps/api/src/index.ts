import dotenv from 'dotenv';
import path from 'path';
import { execSync } from 'child_process';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

function envFlagTrue(name: string): boolean {
  const v = (process.env[name] || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

async function main() {
  // Opt-in only — production/deploy must set DATABASE_URL and leave this unset/false
  if (envFlagTrue('USE_EMBEDDED_PG')) {
    const { ensureEmbeddedPostgres } = await import('./lib/embedded-pg');
    await ensureEmbeddedPostgres();
  } else if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required. For local-only without Docker Postgres, set USE_EMBEDDED_PG=true. For deploy, set DATABASE_URL to your managed Postgres.',
    );
  }

  try {
    execSync('npx prisma db push --skip-generate', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: process.env,
    });
  } catch (err) {
    console.warn('[bootstrap] prisma db push warning:', err);
  }

  const { startApp } = await import('./server');
  await startApp();
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

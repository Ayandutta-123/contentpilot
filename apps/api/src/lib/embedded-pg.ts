import path from 'path';
import fs from 'fs';
import net from 'net';
import EmbeddedPostgres from 'embedded-postgres';

/**
 * Optional local-only Postgres when Docker/managed DB is unavailable.
 * Enable explicitly with USE_EMBEDDED_PG=true — never the default for deploy.
 * All connection details come from env (no fixed localhost assumptions beyond loopback for the embedded process).
 */
export async function ensureEmbeddedPostgres(): Promise<string> {
  const port = Number(process.env.EMBEDDED_PG_PORT || 5433);
  const user = process.env.EMBEDDED_PG_USER || 'contentpilot';
  const password = process.env.EMBEDDED_PG_PASSWORD || 'contentpilot';
  const database = process.env.EMBEDDED_PG_DATABASE || 'contentpilot';
  const host = process.env.EMBEDDED_PG_HOST || '127.0.0.1';
  const dataDir =
    process.env.EMBEDDED_PG_DATA_DIR ||
    path.resolve(process.cwd(), '../../data/postgres');

  const url =
    process.env.DATABASE_URL ||
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;

  if (await isPortOpen(port, host)) {
    console.log(`[embedded-pg] Already listening on ${host}:${port}`);
    process.env.DATABASE_URL = url;
    return url;
  }

  fs.mkdirSync(dataDir, { recursive: true });

  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent: true,
    onLog: () => undefined,
    onError: (msg: string) => console.error('[embedded-pg]', msg),
  });

  const alreadyInit = fs.existsSync(path.join(dataDir, 'PG_VERSION'));
  if (!alreadyInit) {
    console.log('[embedded-pg] Initialising database at', dataDir);
    await instance.initialise();
  }

  console.log(`[embedded-pg] Starting on ${host}:${port}…`);
  try {
    await instance.start();
  } catch (err) {
    if (await isPortOpen(port, host)) {
      console.log(`[embedded-pg] Port ${port} became available — continuing`);
    } else {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  try {
    await instance.createDatabase(database);
  } catch {
    // already exists
  }

  process.env.DATABASE_URL = url;
  console.log('[embedded-pg] Ready');
  return url;
}

function isPortOpen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

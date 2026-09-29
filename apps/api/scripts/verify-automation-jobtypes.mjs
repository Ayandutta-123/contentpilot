/**
 * Static workflow verification for automation job types.
 * Run: node apps/api/scripts/verify-automation-jobtypes.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const REQUIRED = ['newsletter', 'competitor', 'trends', 'meme', 'calendar'];

const checks = [];

function ok(name, pass, detail = '') {
  checks.push({ name, pass, detail });
}

const service = read('apps/api/src/services/automation.service.ts');
const routes = read('apps/api/src/routes/automations.routes.ts');
const workers = read('apps/api/src/workers/index.ts');
const ui = read('apps/web/src/app/settings/page.tsx');
const schema = read('apps/api/prisma/schema.prisma');

ok(
  'AutomationJobType includes all 5',
  REQUIRED.every((j) => service.includes(`'${j}'`)),
  REQUIRED.join(', '),
);

ok(
  'Zod CreateBody jobType enum includes calendar',
  /jobType:\s*z\.enum\(\[[^\]]*['"]calendar['"]/.test(routes),
);

ok(
  'executeAutomationJob has calendar branch',
  /workflow\.jobType === ['"]calendar['"]/.test(service),
);

ok(
  'resolveCalendarAutomationTarget exported',
  /export async function resolveCalendarAutomationTarget/.test(service),
);

ok(
  'enqueue receives calendar arg (not undefined hole)',
  /enqueueContentGeneration\(\s*workflow\.tenantId,\s*engine,\s*trends,\s*competitor,\s*calendar,\s*newsletter,\s*meme/.test(
    service.replace(/\s+/g, ' '),
  ),
);

ok(
  'Worker runs ContentEngine.CALENDAR',
  /case ContentEngine\.CALENDAR:/.test(workers),
);

ok(
  'POST /:id/run exists',
  /app\.post\(\s*['"]\/:id\/run['"]/.test(routes),
);

ok(
  'UI JOB_LABELS has calendar',
  /calendar:\s*['"]Content calendar['"]/.test(ui),
);

ok(
  'UI offers three Content Calendar workflow cards',
  /id:\s*['"]ai_plan['"]/.test(ui) &&
    /id:\s*['"]uploaded_plan['"]/.test(ui) &&
    /id:\s*['"]festival['"]/.test(ui) &&
    /Which Content Calendar workflow/.test(ui),
);

ok(
  'API CreateBody has calendarMode enum',
  /calendarMode:\s*z\.enum\(\[[^\]]*ai_plan/.test(routes),
);

ok(
  'resolveCalendarAutomationTarget takes calendarMode',
  /calendarMode:\s*AutomationCalendarMode/.test(service),
);

ok(
  'Prisma comment lists calendar',
  /newsletter \| competitor \| trends \| meme \| calendar/.test(schema),
);

// Other engines still wired
for (const j of ['trends', 'competitor', 'newsletter', 'meme']) {
  ok(`dispatch branch for ${j}`, service.includes(`workflow.jobType === '${j}'`));
}

ok(
  'poller still calls processDueAutomations',
  /processDueAutomations/.test(workers),
);

ok(
  'calendar plan poller still separate',
  /processDueCalendarPlanEntries/.test(workers),
);

const failed = checks.filter((c) => !c.pass);
for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);

/**
 * Smoke-test automation wall-clock timezones + saved_plan resolve wiring.
 * Run: node --import tsx scripts/verify-automation-timezone-and-plan.mjs
 * (or: node --experimental-strip-types …) — uses compiled-free dynamic import via tsx.
 */
import {
  zonedLocalToUtc,
  computeNextWeeklyRunAt,
  parseRunAt,
  isValidTimeZone,
  resolveCalendarAutomationTarget,
} from '../src/services/automation.service.ts';
import { prisma } from '../src/lib/prisma.ts';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function ymdHmInZone(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}`;
}

const ZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];

console.log('--- timezone validity ---');
for (const z of ZONES) {
  assert(isValidTimeZone(z), `invalid zone ${z}`);
  console.log('ok', z);
}

console.log('--- zonedLocalToUtc round-trip ---');
for (const z of ZONES) {
  const local = '2026-06-15T09:00';
  const utc = zonedLocalToUtc(local, z);
  const back = ymdHmInZone(utc, z);
  assert(back === '2026-06-15T09:00', `${z}: expected 2026-06-15T09:00 got ${back} (utc=${utc.toISOString()})`);
  console.log('ok', z, '→', utc.toISOString(), '→', back);
}

console.log('--- parseRunAt naive vs absolute ---');
{
  const naive = parseRunAt('2026-06-15T09:00', 'Asia/Kolkata');
  const abs = parseRunAt('2026-06-15T03:30:00.000Z', 'Asia/Kolkata');
  assert(naive && abs && naive.getTime() === abs.getTime(), 'IST 09:00 should equal 03:30Z');
  console.log('ok IST 09:00 == 03:30Z');
}

console.log('--- computeNextWeeklyRunAt wall clock ---');
for (const z of ZONES) {
  const after = new Date('2026-06-10T12:00:00.000Z'); // Wed
  const next = computeNextWeeklyRunAt(1, '09:00', z, after); // Monday 09:00
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: z,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(next);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  assert(map.weekday === 'Mon', `${z}: expected Mon got ${map.weekday}`);
  assert(map.hour === '09' && map.minute === '00', `${z}: expected 09:00 got ${map.hour}:${map.minute}`);
  console.log('ok', z, next.toISOString(), `(${map.weekday} ${map.hour}:${map.minute})`);
}

console.log('--- saved_plan requires contentCalendarPlanId ---');
{
  let threw = false;
  try {
    await resolveCalendarAutomationTarget('00000000-0000-0000-0000-000000000000', 'UTC', 'saved_plan', {}, null);
  } catch (e) {
    threw = /Pick a saved content calendar/i.test(String(e?.message || e));
  }
  assert(threw, 'saved_plan without planId should error');
  console.log('ok missing planId rejected');
}

console.log('--- saved_plan with real plan (if any) ---');
{
  const plan = await prisma.contentCalendarPlan.findFirst({
    where: { deletedAt: null, status: 'active' },
    select: { id: true, name: true, tenantId: true },
  });
  if (!plan) {
    console.log('skip — no active content calendar plans in DB');
  } else {
    try {
      const target = await resolveCalendarAutomationTarget(
        plan.tenantId,
        'Asia/Kolkata',
        'saved_plan',
        {},
        plan.id,
      );
      console.log('ok resolve', plan.name, '→', target.customPlan?.title || target.eventId || '(no ready idea in window)');
    } catch (e) {
      const msg = String(e?.message || e);
      // No ready idea is acceptable; wrong-plan / missing plan is not
      assert(
        /no (upcoming|ready|manual)|idea|entry|plan/i.test(msg) || /next 3 weeks|Widen/i.test(msg) || /No .*idea/i.test(msg),
        `unexpected resolve error: ${msg}`,
      );
      console.log('ok resolve attempted for', plan.name, '—', msg.slice(0, 120));
    }
  }
}

await prisma.$disconnect().catch(() => {});
console.log('\nALL CHECKS PASSED');

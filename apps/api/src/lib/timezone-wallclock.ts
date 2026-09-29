/**
 * Convert a local wall-clock date+time in a named IANA timezone to a UTC Date.
 */
export function wallClockInZoneToUtc(
  dateYmd: string,
  timeHm: string,
  timeZone: string,
): Date {
  const [Y, M, D] = dateYmd.split('-').map(Number);
  const [h, m] = (timeHm || '09:00').split(':').map(Number);
  if (!Y || !M || !D || Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error('Invalid date or time');
  }

  let utcMs = Date.UTC(Y, M - 1, D, h, m, 0);
  const desiredAsUtcParts = Date.UTC(Y, M - 1, D, h, m, 0);

  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(utcMs));

    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    utcMs += desiredAsUtcParts - asUtc;
  }

  return new Date(utcMs);
}

export const COMMON_TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Berlin', label: 'Berlin / CET' },
  { value: 'America/New_York', label: 'US Eastern' },
  { value: 'America/Los_Angeles', label: 'US Pacific' },
  { value: 'UTC', label: 'UTC' },
] as const;

export function isValidTimeHm(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim());
}

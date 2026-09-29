/**
 * npx tsx scripts/test-market-countries.ts
 */
import {
  GCC_CODES,
  MARKET_COUNTRIES,
  countryLabels,
  marketGuidanceForPrompt,
  normalizeTargetCountries,
  resolveMarketCountries,
} from '../src/lib/market-countries';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(GCC_CODES.length === 6, 'GCC must be 6 states');
for (const code of GCC_CODES) {
  assert(MARKET_COUNTRIES.some((c) => c.code === code && c.region === 'gcc'), `missing GCC ${code}`);
}

assert(normalizeTargetCountries(['ae', 'qa', 'worldwide']).join() === 'worldwide', 'worldwide wins');
assert(normalizeTargetCountries(['ae', 'om']).join() === 'AE,OM', 'gcc codes normalize');

const gcc = resolveMarketCountries(['AE', 'SA', 'QA', 'KW', 'BH', 'OM']);
assert(gcc.length === 6, 'resolve all gcc');
assert(countryLabels(['QA']).includes('Qatar'), 'qatar label');

const prompt = marketGuidanceForPrompt(['AE', 'QA']);
assert(prompt.includes('United Arab Emirates'), 'prompt names UAE');
assert(prompt.includes('Qatar'), 'prompt names Qatar');
assert(/GCC|Gulf/.test(prompt), 'prompt has GCC localization');
assert(!marketGuidanceForPrompt(['worldwide']).includes('Gulf English'), 'worldwide is global');

console.log('ok   market countries — GCC + prompt wiring');

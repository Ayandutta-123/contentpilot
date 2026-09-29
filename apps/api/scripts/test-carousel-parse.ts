/**
 * Quick sanity checks for carousel parse + clamp (no LLM).
 * Run: npx tsx scripts/test-carousel-parse.ts
 */
import {
  clampSlideCount,
  parseCarouselSlideCount,
  CAROUSEL_MAX_SLIDES,
  CAROUSEL_MIN_SLIDES,
} from '../src/lib/carousel-parse';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const cases: Array<{ parts: string[]; expect: number | null }> = [
  { parts: ['Tip series', 'Carousel (4 slides)'], expect: 4 },
  { parts: ['Launch', '4-slide carousel'], expect: 4 },
  { parts: ['Hiring', 'carousel'], expect: 3 },
  { parts: ['Feature', 'Carousel (9 slides)'], expect: 9 },
  { parts: ['Deep dive', 'Carousel (12 slides)'], expect: CAROUSEL_MAX_SLIDES },
  { parts: ['Culture', 'no carousel'], expect: null },
  { parts: ['Announcement'], expect: null },
  { parts: ['Deck', 'multi-page · slides: 5'], expect: 5 },
  { parts: ['X', 'carousal 2'], expect: 2 },
];

let failed = 0;
for (const c of cases) {
  const got = parseCarouselSlideCount(...c.parts);
  if (got !== c.expect) {
    failed += 1;
    console.error('FAIL', c.parts, 'got', got, 'expected', c.expect);
  } else {
    console.log('ok', c.parts.join(' · '), '→', got);
  }
}

assert(clampSlideCount(1) === CAROUSEL_MIN_SLIDES, 'clamp low');
assert(clampSlideCount(99) === CAROUSEL_MAX_SLIDES, 'clamp high');
assert(clampSlideCount(3) === 3, 'clamp mid');

if (failed) {
  console.error(`\n${failed} parse case(s) failed`);
  process.exit(1);
}
console.log('\nAll carousel parse checks passed.');

/**
 * Carousel quality contracts — no LLM, no fal.
 * Run: npx tsx scripts/test-carousel-quality.ts
 */
import {
  applyCarouselCopyContract,
  carouselArtPrefix,
  carouselSlideRole,
  CAROUSEL_CLOSE_LAYOUTS,
  CAROUSEL_COVER_LAYOUTS,
  CAROUSEL_PROOF_LAYOUTS,
  finalizeArtPrompt,
  layoutPillarBudget,
  pickCarouselLayouts,
} from '../src/services/poster-layout-pick';
import type { PosterSpec } from '../src/providers/images/poster-frame';
import { brandPosterFrame } from '../src/providers/images/poster-frame';
import { config } from '../src/config';
import fs from 'fs';
import path from 'path';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const crowded: PosterSpec = {
  eyebrow: 'PRE-SEED DILIGENCE',
  headline: 'The Data Room That Earns A Second Meeting',
  headlineAccent: 'Second Meeting',
  subhead: 'Before we meet a founder, we meet their files and then we ask for more documents than anyone expected.',
  pillars: [{ icon: 'lock', title: 'Files', text: 'We open four packs first' }],
  statValue: '4',
  statLabel: 'files we open first, every single time',
  calloutTitle: 'Why it matters',
  calloutBody: 'Second meetings come from clean rooms.',
  closingLine: 'Book a diligence call',
  footerNote: 'risin.vc',
  artPrompt: 'Bright white notepad under a spotlight on a grey desk.',
};

let failed = 0;
function check(name: string, cond: unknown) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name);
  } else {
    console.log('ok', name);
  }
}

// Roles
check('cover role index 0', carouselSlideRole(0, 3) === 'cover');
check('proof role index 1 of 3', carouselSlideRole(1, 3) === 'proof');
check('close role last', carouselSlideRole(2, 3) === 'close');
check('2-slide has no proof', carouselSlideRole(1, 2) === 'close');

// Cover layouts never put type on a bright full-bleed photo
for (let n = 2; n <= 8; n++) {
  for (let s = 0; s < 12; s++) {
    const layouts = pickCarouselLayouts(n, `seed-${n}-${s}`);
    check(`cover not center_stage n=${n} s=${s}`, layouts[0] !== 'center_stage');
    check(`cover in cover pool n=${n} s=${s}`, CAROUSEL_COVER_LAYOUTS.includes(layouts[0]!));
    check(`close in close pool n=${n} s=${s}`, CAROUSEL_CLOSE_LAYOUTS.includes(layouts[n - 1]!));
    check(`layout count n=${n} s=${s}`, layouts.length === n);
    for (let i = 1; i < n - 1; i++) {
      check(
        `proof pool n=${n} s=${s} i=${i}`,
        CAROUSEL_PROOF_LAYOUTS.includes(layouts[i]!),
      );
    }
  }
}

check('cover pillar budget 0', layoutPillarBudget('hero_right', { isFirst: true }) === 0);
check('close pillar budget 0', layoutPillarBudget('hero_right', { isLast: true }) === 0);

const cover = applyCarouselCopyContract(crowded, 'cover', 'split_band');
check('cover strips stat', !cover.statValue);
check('cover strips callout', !cover.calloutTitle && !cover.calloutBody);
check('cover strips pillars', !cover.pillars?.length);
check('cover strips closing', !cover.closingLine);
check('cover keeps headline', cover.headline.includes('Data Room'));
check('cover clips long subhead', (cover.subhead || '').split(/\s+/).length <= 16);

const close = applyCarouselCopyContract(crowded, 'close', 'split_band');
check('close strips stat', !close.statValue);
check('close strips pillars', !close.pillars?.length);
check('close keeps CTA', Boolean(close.closingLine));

const proof = applyCarouselCopyContract(crowded, 'proof', 'hero_right');
check('proof can keep a stat', proof.statValue === '4');
check('proof drops callout when pillars+stat', !proof.calloutTitle);

const art = finalizeArtPrompt(
  `${carouselArtPrefix('cover')} Bright notepad. Hero photo bleeds in from the RIGHT for typography.`,
  'split_band',
);
check('art prefix present', art.toLowerCase().includes('cover photograph'));
check('art strips layout jargon', !/bleeds? in|typography|type column/i.test(art));
check('art asks darker lower band', /underexposed|calm|lower/i.test(art));

// Compositor: cover spec must not paint a giant stat card; veil must be dense.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function compositorChecks() {
  const tenantId = '__carousel-quality__';
  const framed = await brandPosterFrame({
    tenantId,
    imageUrl: PIXEL,
    spec: cover,
    companyName: 'Risin Ventures',
    layout: 'split_band',
    slideLabel: '1 / 3',
    palette: {
      ground: '#0B1220',
      ink: '#F7F4EE',
      accent: '#E23A2E',
      muted: '#9AA3B2',
      panel: '#152033',
    },
    width: 1080,
    height: 1080,
  });
  const svgPath = path.join(
    config.UPLOAD_DIR,
    tenantId,
    'social-images',
    path.basename(framed.publicUrl),
  );
  const svg = fs.readFileSync(svgPath, 'utf8');
  check('svg wrote', svg.includes('<svg'));
  check('cover svg has no stat 4 card', !/>4</.test(svg));
  check('cover svg has headline', svg.includes('Data Room'));
  check('cover uses split type band (seam or ground)', svg.includes('split') || svg.includes('#0B1220'));
  check('brand color grade overlay present', /opacity="0\.1[06]"/.test(svg));

  const veil = await brandPosterFrame({
    tenantId,
    imageUrl: PIXEL,
    spec: { headline: 'Darker cover test', subhead: 'Readable type' },
    companyName: 'Risin Ventures',
    layout: 'center_stage',
    width: 1080,
    height: 1080,
    palette: {
      ground: '#0B1220',
      ink: '#F7F4EE',
      accent: '#E23A2E',
      muted: '#9AA3B2',
      panel: '#152033',
    },
  });
  const veilSvg = fs.readFileSync(
    path.join(config.UPLOAD_DIR, tenantId, 'social-images', path.basename(veil.publicUrl)),
    'utf8',
  );
  check('center_stage veil is dense (0.78)', veilSvg.includes('opacity="0.78"'));
  check('center_stage type band 0.82', veilSvg.includes('opacity="0.82"'));
  check('center_stage mid veil not 0.2', !veilSvg.includes('stop-opacity="0.2"'));
}

compositorChecks()
  .then(() => {
    if (failed) {
      console.error(`\n${failed} check(s) failed`);
      process.exit(1);
    }
    console.log('\nAll carousel quality checks passed.');
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

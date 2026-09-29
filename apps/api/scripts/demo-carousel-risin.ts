/**
 * Reframe the Risin cover photo with the new cover/proof/close contracts.
 * Run: npx tsx scripts/demo-carousel-risin.ts
 */
import {
  applyCarouselCopyContract,
  pickCarouselLayouts,
} from '../src/services/poster-layout-pick';
import { brandPosterFrame, type PosterSpec } from '../src/providers/images/poster-frame';
import { config } from '../src/config';
import path from 'path';

// Pass the cover photo with DEMO_SOURCE_IMAGE=/path/or/url
const SRC = process.env.DEMO_SOURCE_IMAGE;
if (!SRC) {
  console.error('Set DEMO_SOURCE_IMAGE to a local file path or URL for the cover photo.');
  process.exit(1);
}

const palette = {
  ground: '#0B1220',
  ink: '#F7F4EE',
  accent: '#E23A2E',
  muted: '#9AA3B2',
  panel: '#152033',
};

async function main() {
  const layouts = pickCarouselLayouts(3, 'risin-demo');
  const crowded: PosterSpec = {
    eyebrow: 'PRE-SEED DILIGENCE',
    headline: 'The Data Room That Earns A Second Meeting',
    headlineAccent: 'Second Meeting',
    subhead: 'Before we meet a founder, we meet their files.',
    pillars: [{ icon: 'lock', title: 'Files', text: 'We open four packs first' }],
    statValue: '4',
    statLabel: 'files we open first, every single time',
    calloutTitle: 'Why',
    calloutBody: 'Second meetings come from clean rooms.',
    closingLine: 'Share your data room',
  };

  const specs: PosterSpec[] = [
    applyCarouselCopyContract(crowded, 'cover', layouts[0]!),
    applyCarouselCopyContract(
      {
        ...crowded,
        headline: 'Four files we open first',
        subhead: 'Cap table, model, legal, product.',
        pillars: [],
      },
      'proof',
      layouts[1]!,
    ),
    applyCarouselCopyContract(
      {
        ...crowded,
        headline: 'Ready when you are',
        subhead: 'Send the room. Earn the second meeting.',
      },
      'close',
      layouts[2]!,
    ),
  ];

  const out = [];
  for (let i = 0; i < specs.length; i++) {
    const framed = await brandPosterFrame({
      tenantId: '__carousel-quality__',
      imageUrl: SRC,
      spec: specs[i]!,
      companyName: 'Risin Ventures',
      layout: layouts[i],
      slideLabel: `${i + 1} / 3`,
      palette,
      width: 1080,
      height: 1080,
    });
    out.push({
      layout: layouts[i],
      file: path.join(config.UPLOAD_DIR, '__carousel-quality__', 'social-images', path.basename(framed.publicUrl)),
      headline: specs[i]!.headline,
      stat: specs[i]!.statValue || null,
    });
  }
  console.log(JSON.stringify({ layouts, slides: out }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

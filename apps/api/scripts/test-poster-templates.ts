/**
 * Render every poster template once with placeholder copy so the layouts can be
 * eyeballed without burning image-model credits.
 *
 *   npx tsx scripts/test-poster-templates.ts
 */
import fs from 'fs';
import path from 'path';
import { config } from '../src/config';
import { brandPosterFrame, type PosterSpec } from '../src/providers/images/poster-frame';
import {
  POSTER_TEMPLATES,
  applyTemplateContract,
  assertThreeTemplatesPerPlay,
} from '../src/services/poster-template-catalog';

const TENANT = '__template-preview';

/**
 * A stand-in hero photo as a raster PNG so the mask/scrim behaviour is visible
 * when the SVG is rasterised for review.
 */
async function writePlaceholderArt(): Promise<string> {
  const dir = path.resolve(config.UPLOAD_DIR, TENANT, 'art');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'placeholder.png');
  const sharp = (await import('sharp')).default;
  await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#4b5f8c"/><stop offset="55%" stop-color="#b08a5f"/>
        <stop offset="100%" stop-color="#20263a"/>
      </linearGradient></defs>
      <rect width="1200" height="1200" fill="url(#g)"/>
      <circle cx="820" cy="380" r="260" fill="#ffffff" opacity="0.22"/>
      <circle cx="360" cy="900" r="200" fill="#000000" opacity="0.26"/>
      <rect x="120" y="140" width="320" height="420" rx="24" fill="#ffffff" opacity="0.10"/>
    </svg>`,
    ),
  )
    .png()
    .toFile(file);
  return file;
}

const SAMPLE: PosterSpec = {
  eyebrow: 'Platform release',
  headline: 'Ship brand-safe campaigns in half the time',
  headlineAccent: 'half the time',
  subhead: 'Approvals, captions and scheduling now run from one queue instead of four tools.',
  pillars: [
    { icon: 'bolt', title: 'One queue', text: 'Every draft lands in the same approval lane with channel-ready captions.' },
    { icon: 'shield', title: 'Brand locked', text: 'Colours, fonts and tone come straight from your Brand Kit on every render.' },
    { icon: 'clock', title: 'Faster loops', text: 'Reviewers reframe a poster in place instead of sending it back to design.' },
  ],
  statValue: '62%',
  statLabel: 'less time from brief to publish',
  calloutTitle: 'Why it matters',
  calloutBody: 'Teams stop rebuilding the same layout for each channel and spend the time on the idea.',
  closingLine: 'See the new approval queue',
  footerNote: 'Rolling out to all workspaces this month.',
  artPrompt: '',
  artNegativePrompt: '',
};

async function main() {
  const art = await writePlaceholderArt();
  const outDir = path.resolve(config.UPLOAD_DIR, TENANT, 'social-images');
  fs.rmSync(outDir, { recursive: true, force: true });

  let failures = 0;
  for (const t of POSTER_TEMPLATES) {
    const spec = applyTemplateContract(SAMPLE, t);
    try {
      const res = await brandPosterFrame({
        tenantId: TENANT,
        imageUrl: art,
        spec,
        companyName: 'Risin Ventures',
        brandImageStyle: null,
        palette: {
          ground: '#0B1220',
          ink: '#F7F4EE',
          muted: '#A9B0BF',
          accent: '#E23A2E',
        },
        layout: t.layout,
        width: 1080,
        height: 1080,
      });
      const file = path.resolve(config.UPLOAD_DIR, res.publicUrl.replace(/^\/uploads\//, ''));
      const svg = fs.readFileSync(file, 'utf8');

      // Contract checks: omitted blocks must not reach the canvas.
      const problems: string[] = [];
      if (t.blocks.pillars && (spec.pillars?.length ?? 0) !== t.blocks.pillars) {
        problems.push(`pillars ${spec.pillars?.length} != ${t.blocks.pillars}`);
      }
      if (!t.blocks.pillars && spec.pillars?.length) problems.push('pillars leaked');
      if (t.blocks.stat === 'omit' && spec.statValue) problems.push('stat leaked');
      if (t.blocks.callout === 'omit' && (spec.calloutTitle || spec.calloutBody)) problems.push('callout leaked');
      if (t.blocks.subhead === 'omit' && spec.subhead) problems.push('subhead leaked');
      if (t.blocks.closing === 'omit' && spec.closingLine) problems.push('closing leaked');
      if (t.blocks.footer === 'omit' && spec.footerNote) problems.push('footer leaked');
      if (t.blocks.eyebrow === 'omit' && spec.eyebrow) problems.push('eyebrow leaked');
      if (!svg.includes('<svg')) problems.push('no svg root');

      const renamed = path.join(outDir, `${t.playId}--${t.id}--${t.layout}.svg`);
      fs.renameSync(file, renamed);

      if (problems.length) {
        failures++;
        console.log(`FAIL ${t.id.padEnd(24)} ${problems.join(', ')}`);
      } else {
        console.log(
          `ok   ${t.id.padEnd(24)} layout=${t.layout.padEnd(15)} pillars=${spec.pillars?.length ?? 0} stat=${spec.statValue || '-'}`,
        );
      }
    } catch (err) {
      failures++;
      console.log(`FAIL ${t.id.padEnd(24)} ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const countIssues = assertThreeTemplatesPerPlay();
  if (countIssues.length) {
    failures += countIssues.length;
    for (const m of countIssues) console.log(`FAIL count  ${m}`);
  }

  const skinny = applyTemplateContract(
    { ...SAMPLE, pillars: SAMPLE.pillars.slice(0, 1) },
    POSTER_TEMPLATES.find((t) => t.blocks.pillars === 3)!,
  );
  if ((skinny.pillars?.length ?? 0) !== 3) {
    failures++;
    console.log(`FAIL pad     expected 3 pillars, got ${skinny.pillars?.length}`);
  }

  console.log(`\n${POSTER_TEMPLATES.length} templates, ${failures} failures`);
  console.log(`SVGs: ${outDir}`);
  if (failures) process.exitCode = 1;
}

void main();

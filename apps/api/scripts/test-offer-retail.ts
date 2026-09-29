/**
 * Render the two retail Offer layouts with Brand Kit colours, logo, and
 * fillable copy — then rasterise so the cutouts / split can be eyeballed.
 *
 *   npx tsx scripts/test-offer-retail.ts
 */
import fs from 'fs';
import path from 'path';
import { config } from '../src/config';
import { brandPosterFrame, type PosterSpec } from '../src/providers/images/poster-frame';
import { applyTemplateContract, getPosterTemplate } from '../src/services/poster-template-catalog';

const TENANT = '__offer-retail-preview';

const CIRCLES: PosterSpec = {
  eyebrow: 'OFFER',
  headline: 'AI Video Generation Software',
  headlineAccent: '',
  subhead:
    'A newly launched Risin Ventures Studio venture brings AI-powered video generation to content and marketing teams',
  pillars: [],
  statValue: '15%',
  statLabel: '',
  calloutTitle: '',
  calloutBody: '',
  closingLine: 'Explore the launch offer',
  footerNote: 'hyperthings.ai',
  artPrompt: '',
  artNegativePrompt: '',
};

const SPLIT: PosterSpec = {
  eyebrow: 'Autumn drop',
  headline: 'Big Sale Offer',
  headlineAccent: 'Sale',
  subhead: '',
  pillars: [],
  statValue: '75%',
  statLabel: 'Off',
  calloutTitle: '',
  calloutBody: '+00 123 456 789',
  closingLine: 'Order Now',
  footerNote: 'www.risinventures.com',
  artPrompt: '',
  artNegativePrompt: '',
};

const KITS = [
  {
    name: 'crimson',
    palette: { ground: '#0B1220', ink: '#F7F4EE', muted: '#A9B0BF', accent: '#E23A2E' },
  },
  {
    name: 'navy',
    palette: { ground: '#071525', ink: '#F4F7FB', muted: '#9AA8BC', accent: '#1D4E89' },
  },
];

async function writeArt(): Promise<string> {
  const dir = path.resolve(config.UPLOAD_DIR, TENANT, 'art');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'hero.png');
  const sharp = (await import('sharp')).default;
  await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1400">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#f2c14e"/>
            <stop offset="55%" stop-color="#e8a03c"/>
            <stop offset="100%" stop-color="#c56a2d"/>
          </linearGradient>
        </defs>
        <rect width="1400" height="1400" fill="url(#bg)"/>
        <ellipse cx="980" cy="620" rx="280" ry="420" fill="#f6e6c8"/>
        <ellipse cx="980" cy="430" rx="150" ry="170" fill="#e8c9a0"/>
        <rect x="820" y="620" width="320" height="520" rx="40" fill="#f3efe6"/>
        <ellipse cx="420" cy="980" rx="200" ry="240" fill="#6b2b1f"/>
        <ellipse cx="420" cy="820" rx="110" ry="120" fill="#c98962"/>
        <rect x="320" y="920" width="210" height="320" rx="20" fill="#b42318"/>
      </svg>`,
    ),
  )
    .png()
    .toFile(file);
  return file;
}

async function writeLogo(): Promise<string> {
  const dir = path.resolve(config.UPLOAD_DIR, TENANT, 'art');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'logo.png');
  const sharp = (await import('sharp')).default;
  await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120">
        <rect width="400" height="120" rx="12" fill="#ffffff"/>
        <text x="200" y="78" text-anchor="middle" font-family="Arial, sans-serif" font-size="54" font-weight="800" fill="#111111">RISIN</text>
      </svg>`,
    ),
  )
    .png()
    .toFile(file);
  return file;
}

async function main() {
  const art = await writeArt();
  const logo = await writeLogo();
  const outDir = path.resolve(config.UPLOAD_DIR, TENANT, 'review');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const jobs: Array<{ id: string; spec: PosterSpec }> = [
    { id: 'offer_sale_circles', spec: CIRCLES },
    { id: 'offer_sale_split', spec: SPLIT },
  ];

  let failures = 0;
  const sharp = (await import('sharp')).default;

  for (const kit of KITS) {
    for (const job of jobs) {
      const template = getPosterTemplate(job.id);
      if (!template) {
        failures++;
        console.log(`FAIL ${job.id} missing from catalog`);
        continue;
      }
      const spec = applyTemplateContract(job.spec, template);
      try {
        const res = await brandPosterFrame({
          tenantId: TENANT,
          imageUrl: art,
          logoUrl: logo,
          spec,
          companyName: 'Risin Ventures',
          brandImageStyle: null,
          palette: kit.palette,
          layout: template.layout,
          width: 1080,
          height: 1080,
        });
        const src = path.resolve(config.UPLOAD_DIR, res.publicUrl.replace(/^\/uploads\//, ''));
        const svg = fs.readFileSync(src, 'utf8');
        const named = path.join(outDir, `${kit.name}--${job.id}.svg`);
        fs.renameSync(src, named);

        const problems: string[] = [];
        if (!svg.includes('clipPath')) problems.push('no clipPath');
        if (!svg.includes('<image')) problems.push('no images');
        if (!svg.toLowerCase().includes(kit.palette.accent.toLowerCase())) problems.push('accent colour missing');
        if (!svg.includes(spec.headline.split(' ')[0])) problems.push('headline missing');
        if (!svg.includes(spec.statValue)) problems.push('stat missing');
        if (!svg.toLowerCase().includes(spec.closingLine.split(' ')[0].toLowerCase())) {
          problems.push('cta missing');
        }
        if (template.layout === 'sale_circles' && !svg.includes('bigCut')) problems.push('no circular cutouts');
        if (template.layout === 'sale_split' && !svg.includes('rightPhoto')) problems.push('no split photo');

        const png = named.replace(/\.svg$/, '.png');
        await sharp(named, { density: 144 }).png().toFile(png);

        if (problems.length) {
          failures++;
          console.log(`FAIL ${kit.name.padEnd(8)} ${job.id.padEnd(22)} ${problems.join(', ')}`);
        } else {
          console.log(`ok   ${kit.name.padEnd(8)} ${job.id.padEnd(22)} ${png}`);
        }
      } catch (err) {
        failures++;
        console.log(
          `FAIL ${kit.name.padEnd(8)} ${job.id.padEnd(22)} ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  console.log(`\n${failures} failures`);
  console.log(`Review: ${outDir}`);
  if (failures) process.exitCode = 1;
}

void main();

/* Render a sample designed poster to /tmp for visual QA. */
import fs from 'fs';
import path from 'path';
import { config } from '../src/config';
import { brandPosterFrame } from '../src/providers/images/poster-frame';

async function main() {
  const art = process.argv[2];
  if (!art || !fs.existsSync(art)) throw new Error('pass a path to hero art png');

  const tenantId = '__poster-sample';
  const dir = path.resolve(config.UPLOAD_DIR, tenantId);
  fs.mkdirSync(dir, { recursive: true });
  const artCopy = path.join(dir, 'art.png');
  fs.copyFileSync(art, artCopy);

  for (const layout of ['hero_right', 'hero_top'] as const) {
    const out = await brandPosterFrame({
      tenantId,
      imageUrl: `/uploads/${tenantId}/art.png`,
      brandImageStyle: 'deep navy #0B1B33 with a red accent #E23A2E, premium B2B',
      companyName: 'Risin Ventures',
      layout,
      slideLabel: layout === 'hero_top' ? '2 / 4' : null,
      spec: {
        eyebrow: 'AI infrastructure',
        headline: 'Dubai just ranked #2 in the world for AI adoption.',
        headlineAccent: '#2',
        subhead: "Here's why that matters for anyone building in the region.",
        pillars: [
          {
            icon: 'chip',
            title: 'Strategic priority',
            text: 'A market where AI adoption is a board-level mandate, not an isolated pilot project.',
          },
          {
            icon: 'handshake',
            title: 'Agile regulation',
            text: 'Public-private collaboration that lets new ideas move from proposal to production fast.',
          },
          {
            icon: 'globe',
            title: 'Real enthusiasm',
            text: 'A region showing some of the strongest measured appetite for AI deployment globally.',
          },
        ],
        statValue: '#1',
        statLabel: 'in the world for adoption intent',
        calloutTitle: 'The harder thing',
        calloutBody: 'Plenty of cities buy the technology. Fewer translate it into services people actually use.',
        closingLine: 'The ecosystem rewards execution, not experimentation.',
        footerNote: 'The infrastructure is ready. The demand is real. The window is open.',
      },
    });

    const svgPath = path.resolve(config.UPLOAD_DIR, out.publicUrl.replace(/^\/uploads\//, ''));
    // sharp/librsvg silently drops embedded raster art, so QA the SVG in a browser.
    const copy = `/tmp/poster-${layout}.svg`;
    fs.copyFileSync(svgPath, copy);
    console.log(copy);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

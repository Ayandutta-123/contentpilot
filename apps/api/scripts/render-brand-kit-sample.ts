/**
 * Render two posters with different Brand Kit modes to verify colors/fonts.
 * Run: npx tsx scripts/render-brand-kit-sample.ts [art.png]
 */
import fs from 'fs';
import path from 'path';
import { config } from '../src/config';
import { brandPosterFrame } from '../src/providers/images/poster-frame';
import { resolveBrandKitPalette, brandKitFromSettings, type BrandKit } from '../src/lib/brand-kit';
import { OVERLAY_FONTS } from '../src/providers/images/social-frame';

async function render(label: string, kit: BrandKit, artUrl: string) {
  const tenantId = '__brand-kit-sample';
  const palette = resolveBrandKitPalette(kit, { seed: label });
  const out = await brandPosterFrame({
    tenantId,
    imageUrl: artUrl,
    companyName: 'Hyperthings',
    brandImageStyle: 'ignored when palette passed',
    palette: palette || undefined,
    headingFontCss: OVERLAY_FONTS[kit.fonts.heading].css,
    bodyFontCss: OVERLAY_FONTS[kit.fonts.body].css,
    layout: 'hero_right',
    spec: {
      eyebrow: 'Brand kit test',
      headline: 'Accent hex must match your kit exactly.',
      headlineAccent: 'exactly',
      subhead: `Mode: ${kit.mode} · accent ${kit.colors.accent}`,
      pillars: [
        { icon: 'spark', title: 'Primary', text: `Ground and primary from kit (${kit.colors.primary}).` },
        { icon: 'layers', title: 'Typography', text: `Heading ${kit.fonts.heading}, body ${kit.fonts.body}.` },
        { icon: 'check', title: 'Mode', text: kit.mode === 'strict' ? 'Exact hexes only.' : 'Brand-led with soft blends.' },
      ],
      statValue: 'OK',
      statLabel: 'kit applied',
      calloutTitle: 'Accent panel',
      calloutBody: 'This badge and accent text use the kit accent color.',
      closingLine: 'Save Brand kit in Settings to go live.',
    },
  });
  const svgPath = path.resolve(config.UPLOAD_DIR, out.publicUrl.replace(/^\/uploads\//, ''));
  const dest = `/tmp/brand-kit-${label}.svg`;
  fs.copyFileSync(svgPath, dest);
  console.log(dest, 'palette=', palette);
}

async function main() {
  const art = process.argv[2];
  if (!art || !fs.existsSync(art)) throw new Error('pass path to a png for hero art');
  const tenantId = '__brand-kit-sample';
  const dir = path.resolve(config.UPLOAD_DIR, tenantId);
  fs.mkdirSync(dir, { recursive: true });
  const artCopy = path.join(dir, 'art.png');
  fs.copyFileSync(art, artCopy);
  const artUrl = `/uploads/${tenantId}/art.png`;

  const teal = brandKitFromSettings({
    brandKitMode: 'strict',
    primaryColor: '#0F172A',
    secondaryColor: '#134E4A',
    accentColor: '#14B8A6',
    backgroundColor: '#0B1220',
    textColor: '#F8FAFC',
    headingFont: 'serif',
    bodyFont: 'sans',
  });

  const coral = brandKitFromSettings({
    brandKitMode: 'mix',
    primaryColor: '#1A1208',
    secondaryColor: '#3D2914',
    accentColor: '#E06B4F',
    backgroundColor: '#140E08',
    textColor: '#F7F4EE',
    headingFont: 'display',
    bodyFont: 'modern',
  });

  await render('strict-teal', teal, artUrl);
  await render('mix-coral', coral, artUrl);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

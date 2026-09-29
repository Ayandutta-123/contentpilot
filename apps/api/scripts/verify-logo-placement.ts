/**
 * Offline check: logoCornerBox + brandSocialFrame / insightSocialFrame honor placement.
 * Does not call fal — run with: npx tsx scripts/verify-logo-placement.ts
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import {
  brandSocialFrame,
  insightSocialFrame,
  logoCornerBox,
  type LogoPlacement,
} from '../src/providers/images/social-frame';

const PLACEMENTS: LogoPlacement[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function checkCornerMath() {
  const w = 1080;
  const h = 1080;
  const logoW = 200;
  const logoH = 70;
  const pad = 40;
  for (const p of PLACEMENTS) {
    const box = logoCornerBox(p, w, h, logoW, logoH, pad);
    if (p.includes('left')) assert(box.x === pad, `${p} x`);
    else assert(box.x === w - pad - logoW, `${p} x`);
    if (p.includes('top')) assert(box.y === pad, `${p} y`);
    else assert(box.y === h - pad - logoH, `${p} y`);
  }
  console.log('ok logoCornerBox math');
}

async function main() {
  checkCornerMath();

  const tenant = await prisma.tenant.findFirst({
    where: { deletedAt: null },
    select: { id: true },
  });
  if (!tenant) throw new Error('no tenant');
  const brand = await prisma.brandSettings.findUnique({
    where: { tenantId: tenant.id },
    select: { logoUrl: true, companyName: true, imageStyle: true },
  });
  if (!brand?.logoUrl) throw new Error('tenant has no logo');

  // Tiny solid PNG as fake art
  const dir = path.resolve(config.UPLOAD_DIR, tenant.id, 'ai-art');
  fs.mkdirSync(dir, { recursive: true });
  // 1x1 red PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const artFile = `verify-art-${Date.now()}.png`;
  fs.writeFileSync(path.join(dir, artFile), png);
  const artUrl = `/uploads/${tenant.id}/ai-art/${artFile}`;

  for (const placement of PLACEMENTS) {
    const framed = await brandSocialFrame({
      tenantId: tenant.id,
      imageUrl: artUrl,
      companyName: brand.companyName,
      logoUrl: brand.logoUrl,
      format: 'instagram_square',
      logoPlacement: placement,
      headerText: 'Verify header',
      footerCta: 'Verify CTA',
      overlay: { overlaysEnabled: true },
    });
    const abs = path.resolve(config.UPLOAD_DIR, framed.publicUrl.replace(/^\/uploads\//, ''));
    const svg = fs.readFileSync(abs, 'utf8');
    const m = svg.match(/<image[^>]*filter="url\(#logoBlend\)"[\s\S]*?<\/g>|<g filter="url\(#logoBlend\)">[\s\S]*?<image[^>]*>/);
    const logoImg = [...svg.matchAll(/<image[^>]+>/g)].find((x) => /logoBlend|preserveAspectRatio="xMidYMid meet"/.test(x[0]) || /width="216"|width="\d+"/.test(x[0]));
    // Find logo image inside logoBlend group
    const block = svg.match(/<g filter="url\(#logoBlend\)">([\s\S]*?)<\/g>/);
    assert(Boolean(block), `${placement}: missing logoBlend group`);
    const xy = block![1].match(/\bx="(\d+(?:\.\d+)?)"\s+y="(\d+(?:\.\d+)?)"/);
    assert(Boolean(xy), `${placement}: missing logo x/y`);
    const x = Number(xy![1]);
    const y = Number(xy![2]);
    const pad = Math.round(Math.min(1080, 1080) * 0.055);
    const logoMaxW = Math.round(1080 * 0.2);
    const logoMaxH = Math.round(1080 * 0.07);
    const expected = logoCornerBox(placement, 1080, 1080, logoMaxW, logoMaxH, pad);
    assert(x === expected.x, `${placement}: x ${x} !== ${expected.x}`);
    assert(y === expected.y, `${placement}: y ${y} !== ${expected.y}`);
    console.log(`ok brandSocialFrame ${placement} → (${x},${y})`);
    void logoImg;
    void m;
  }

  for (const placement of PLACEMENTS) {
    const framed = await insightSocialFrame({
      tenantId: tenant.id,
      imageUrl: artUrl,
      companyName: brand.companyName,
      logoUrl: brand.logoUrl,
      brandImageStyle: brand.imageStyle,
      logoPlacement: placement,
      report: {
        headline: 'Insight verify',
        subheadline: 'Sub',
        points: [
          { title: 'A', text: 'Point A' },
          { title: 'B', text: 'Point B' },
          { title: 'C', text: 'Point C' },
        ],
        summary: 'Summary line',
        calloutTitle: 'Next',
        calloutBody: 'Do the thing',
      },
      width: 1080,
      height: 1350,
    });
    const abs = path.resolve(config.UPLOAD_DIR, framed.publicUrl.replace(/^\/uploads\//, ''));
    const svg = fs.readFileSync(abs, 'utf8');
    // First logo-sized image (168x44) is the brand mark
    const logoTag = [...svg.matchAll(/<image[^>]+>/g)].find((t) => /width="168"/.test(t[0]));
    assert(Boolean(logoTag), `${placement}: insight missing logo image`);
    const xy = logoTag![0].match(/\bx="(\d+(?:\.\d+)?)"\s+y="(\d+(?:\.\d+)?)"/);
    assert(Boolean(xy), `${placement}: insight missing x/y`);
    const x = Number(xy![1]);
    const y = Number(xy![2]);
    const pad = Math.round(Math.min(1080, 1350) * 0.055);
    const expected = logoCornerBox(placement, 1080, 1350, 168, 44, pad);
    assert(x === expected.x, `insight ${placement}: x ${x} !== ${expected.x}`);
    assert(y === expected.y, `insight ${placement}: y ${y} !== ${expected.y}`);
    console.log(`ok insightSocialFrame ${placement} → (${x},${y})`);
  }

  console.log('ALL LOGO PLACEMENT CHECKS PASSED');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

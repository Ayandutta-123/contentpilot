/**
 * Unit checks for Brand Kit modes — no network, no DB required.
 * Run: npx tsx scripts/test-brand-kit.ts
 */
import {
  brandKitArtStyleLine,
  brandKitFromSettings,
  defaultBrandKit,
  normalizeHex,
  resolveBrandKitPalette,
  shouldApplyBrandKit,
} from '../src/lib/brand-kit';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function main() {
  assert(normalizeHex('e23a2e', '#000') === '#E23A2E', 'normalize adds # and uppercases');
  assert(normalizeHex('#abc', '#000') === '#AABBCC', 'normalize expands 3-digit');
  assert(normalizeHex('not-a-color', '#0B1F3A') === '#0B1F3A', 'normalize falls back');

  assert(shouldApplyBrandKit('off') === false, 'off never applies');
  assert(shouldApplyBrandKit('strict') === true, 'strict always applies');
  assert(shouldApplyBrandKit('mix') === true, 'mix always applies');

  const seedA = 'content-aaa';
  const seedB = 'content-bbb';
  const a1 = shouldApplyBrandKit('sometimes', seedA);
  const a2 = shouldApplyBrandKit('sometimes', seedA);
  assert(a1 === a2, 'sometimes is stable for same seed');
  // Across many seeds, both true and false should appear
  let trues = 0;
  let falses = 0;
  for (let i = 0; i < 40; i++) {
    if (shouldApplyBrandKit('sometimes', `seed-${i}`)) trues++;
    else falses++;
  }
  assert(trues > 5 && falses > 5, `sometimes should split (~50%), got true=${trues} false=${falses}`);

  const kit = brandKitFromSettings({
    brandKitMode: 'strict',
    primaryColor: '#0B1F3A',
    secondaryColor: '#1E3A5F',
    accentColor: '#00FFAA',
    backgroundColor: '#0B1220',
    textColor: '#F7F4EE',
    headingFont: 'serif',
    bodyFont: 'display',
  });
  assert(kit.mode === 'strict', 'fromSettings mode');
  assert(kit.fonts.heading === 'serif', 'fromSettings heading font');
  assert(kit.colors.accent === '#00FFAA', 'fromSettings accent');

  const strict = resolveBrandKitPalette({ ...kit, mode: 'strict' }, { seed: seedA });
  assert(strict && strict.applied, 'strict palette applied');
  assert(strict!.accent === '#00FFAA', 'strict keeps exact accent');
  assert(strict!.ground === '#0B1220', 'strict keeps exact ground');

  const mix = resolveBrandKitPalette({ ...kit, mode: 'mix' }, { seed: seedA });
  assert(mix && mix.applied, 'mix palette applied');
  assert(mix!.accent === '#00FFAA', 'mix keeps accent');
  // mix softens ground — may differ from raw background
  assert(typeof mix!.ground === 'string' && mix!.ground.startsWith('#'), 'mix ground is hex');

  const off = resolveBrandKitPalette({ ...kit, mode: 'off' }, { seed: seedA });
  assert(off === null, 'off returns null palette');

  // sometimes with seed that applies
  const sometimesKit = { ...kit, mode: 'sometimes' as const };
  const appliedSeed = shouldApplyBrandKit('sometimes', seedA) ? seedA : seedB;
  // find a seed that applies and one that doesn't
  let onSeed = '';
  let offSeed = '';
  for (let i = 0; i < 100; i++) {
    const s = `probe-${i}`;
    if (shouldApplyBrandKit('sometimes', s)) onSeed = onSeed || s;
    else offSeed = offSeed || s;
  }
  assert(onSeed && offSeed, 'found both sometimes seeds');
  assert(resolveBrandKitPalette(sometimesKit, { seed: onSeed })?.applied === true, 'sometimes on');
  assert(resolveBrandKitPalette(sometimesKit, { seed: offSeed }) === null, 'sometimes off');

  const line = brandKitArtStyleLine(kit, true);
  assert(line.includes('#00FFAA'), 'art style mentions accent');
  assert(brandKitArtStyleLine(kit, false) === '', 'no line when not applied');
  assert(defaultBrandKit().mode === 'mix', 'default mode is mix');

  // unused var silence
  void appliedSeed;

  console.log('brand-kit tests: OK');
}

main();

/**
 *   npx tsx scripts/test-image-prompt-sanitize.ts
 */
import assert from 'assert';
import {
  assembleFalPromptFrontLoaded,
  isMetadataOnlyImagePrompt,
  resolveGenerationImagePrompt,
} from '../src/lib/image-prompt-sanitize';

const poisoned =
  'Reference photo: an industrial vehicle with a raw brushed stainless steel body. Metadata description of the reused competitor image only.\nLinkedIn B2B social visual for: In deep tech hardware, the product is often your first marketing channel.';

assert.equal(isMetadataOnlyImagePrompt(poisoned), true);

const cleaned = resolveGenerationImagePrompt({
  userPrompt: poisoned,
  headline: 'In deep tech hardware, the product is often your first marketing channel',
  body: 'Most IoT founders treat go-to-market as a phase after the build.',
  brandType: 'b2b',
  imageStyle: 'professional B2B',
  exact: false,
});
assert.ok(!/^reference photo:/i.test(cleaned));
assert.ok(!/metadata description/i.test(cleaned));
assert.match(cleaned, /deep tech hardware/i);
assert.ok(cleaned.length > 80);

const longScene = 'SCENE_START ' + 'important subject detail. '.repeat(600);
const assembled = assembleFalPromptFrontLoaded(longScene, ['BRAND_KIT_TAIL style navy teal'], 12000);
assert.ok(assembled.startsWith('SCENE_START'));
assert.ok(assembled.length > 2000);
assert.ok(assembled.length <= 12000);
assert.ok(assembled.includes('important subject detail'));

console.log('image-prompt-sanitize: ok');
console.log('cleanedPreview:', cleaned.slice(0, 180) + '…');
console.log('assembledChars:', assembled.length);

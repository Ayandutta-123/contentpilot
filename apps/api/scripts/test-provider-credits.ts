/**
 *   npx tsx scripts/test-provider-credits.ts
 */
import assert from 'assert';
import {
  classifyProviderCreditError,
  isCreditFailureText,
  toProviderCreditError,
} from '../src/lib/provider-credits';

assert.equal(isCreditFailureText('nope', 500), false);
assert.equal(isCreditFailureText('', 402), true);
assert.equal(isCreditFailureText('', 432), true);
assert.equal(isCreditFailureText('You exceeded your current quota, please check billing', 429), true);
assert.equal(isCreditFailureText('Rate limit exceeded', 429), false);

const claude = classifyProviderCreditError(
  new Error('credit balance is too low to complete this request'),
  'claude',
  'caption',
);
assert.ok(claude);
assert.equal(claude.tool, 'claude');
assert.match(claude.message, /text model are out of credits/);
assert.match(claude.title, /Add money to Text model/);

const openai = classifyProviderCreditError(
  { status: 429, code: 'insufficient_quota', message: 'You exceeded your current quota' },
  'openai',
  'image',
);
assert.ok(openai);
assert.equal(openai.tool, 'openai');
assert.match(openai.message, /create the image/);

const fal = toProviderCreditError(
  new Error('fal.ai 402 Payment Required: User is locked, spend limit reached'),
  'fal',
  'image',
);
assert.ok(fal);
assert.equal(fal.code, 'PROVIDER_CREDITS');
assert.equal(fal.statusCode, 402);

const key = classifyProviderCreditError(new Error('fal.ai rejected the API key (401)'), 'fal', 'image');
assert.equal(key, null);

const tavily = toProviderCreditError(
  new Error('Tavily search failed (432): Payment Required'),
  'tavily',
  'search',
);
assert.ok(tavily);
assert.equal(tavily.tool, 'tavily');
assert.match(tavily.message, /search for news/);
assert.match(tavily.message, /search credits are out of credits/);

const apify = toProviderCreditError(
  new Error('apify 402 Payment Required: not enough credit'),
  'apify',
  'scrape',
);
assert.ok(apify);
assert.equal(apify.tool, 'apify');
assert.match(apify.message, /scrape competitors/);
assert.match(apify.toJSON().title, /Scraping credits/);
assert.match(apify.toolLabel, /Scraping credits/);

const apifyToken = classifyProviderCreditError(
  new Error('Scraping service rejected this API token. Paste a fresh token in Settings → Integrations.'),
  'apify',
  'scrape',
);
assert.equal(apifyToken, null);

console.log('provider-credits: ok');

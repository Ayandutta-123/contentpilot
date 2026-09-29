/**
 * Market focus countries — Settings picker + meme/culture scrapes + LLM localization.
 * `worldwide` = no country filter (global Reddit + global queries).
 */
export type MarketRegion =
  | 'worldwide'
  | 'gcc'
  | 'south_asia'
  | 'middle_east'
  | 'europe'
  | 'americas'
  | 'africa'
  | 'apac';

export type MarketCountry = {
  code: string;
  label: string;
  region: MarketRegion;
  /** Google Trends geo code (empty = global) */
  trendsGeo: string;
  /** Optional Reddit communities that skew local culture */
  redditSubs: string[];
};

export const GCC_CODES = ['AE', 'SA', 'QA', 'KW', 'BH', 'OM'] as const;

export const MARKET_COUNTRIES: MarketCountry[] = [
  {
    code: 'worldwide',
    label: 'Worldwide',
    region: 'worldwide',
    trendsGeo: '',
    redditSubs: ['memes', 'dankmemes', 'me_irl', 'wholesomememes'],
  },
  // GCC — all six member states
  {
    code: 'AE',
    label: 'United Arab Emirates',
    region: 'gcc',
    trendsGeo: 'AE',
    redditSubs: ['dubai', 'UAE', 'abudhabi', 'memes'],
  },
  {
    code: 'SA',
    label: 'Saudi Arabia',
    region: 'gcc',
    trendsGeo: 'SA',
    redditSubs: ['saudiarabia', 'Riyadh', 'memes'],
  },
  {
    code: 'QA',
    label: 'Qatar',
    region: 'gcc',
    trendsGeo: 'QA',
    redditSubs: ['qatar', 'doha', 'memes'],
  },
  {
    code: 'KW',
    label: 'Kuwait',
    region: 'gcc',
    trendsGeo: 'KW',
    redditSubs: ['kuwait', 'memes'],
  },
  {
    code: 'BH',
    label: 'Bahrain',
    region: 'gcc',
    trendsGeo: 'BH',
    redditSubs: ['bahrain', 'memes'],
  },
  {
    code: 'OM',
    label: 'Oman',
    region: 'gcc',
    trendsGeo: 'OM',
    redditSubs: ['oman', 'muscat', 'memes'],
  },
  {
    code: 'EG',
    label: 'Egypt',
    region: 'middle_east',
    trendsGeo: 'EG',
    redditSubs: ['Egypt', 'memes'],
  },
  {
    code: 'IN',
    label: 'India',
    region: 'south_asia',
    trendsGeo: 'IN',
    redditSubs: ['IndianDankMemes', 'india', 'bollywood', 'memes'],
  },
  {
    code: 'PK',
    label: 'Pakistan',
    region: 'south_asia',
    trendsGeo: 'PK',
    redditSubs: ['Pakistan', 'memes'],
  },
  {
    code: 'BD',
    label: 'Bangladesh',
    region: 'south_asia',
    trendsGeo: 'BD',
    redditSubs: ['bangladesh', 'memes'],
  },
  {
    code: 'US',
    label: 'United States',
    region: 'americas',
    trendsGeo: 'US',
    redditSubs: ['memes', 'dankmemes', 'AdviceAnimals'],
  },
  {
    code: 'CA',
    label: 'Canada',
    region: 'americas',
    trendsGeo: 'CA',
    redditSubs: ['canada', 'memes'],
  },
  {
    code: 'BR',
    label: 'Brazil',
    region: 'americas',
    trendsGeo: 'BR',
    redditSubs: ['botecodoreddit', 'memes'],
  },
  {
    code: 'GB',
    label: 'United Kingdom',
    region: 'europe',
    trendsGeo: 'GB',
    redditSubs: ['ukmemes', 'CasualUK', 'memes'],
  },
  {
    code: 'DE',
    label: 'Germany',
    region: 'europe',
    trendsGeo: 'DE',
    redditSubs: ['ich_iel', 'memes'],
  },
  {
    code: 'FR',
    label: 'France',
    region: 'europe',
    trendsGeo: 'FR',
    redditSubs: ['rance', 'memes'],
  },
  {
    code: 'NG',
    label: 'Nigeria',
    region: 'africa',
    trendsGeo: 'NG',
    redditSubs: ['Nigeria', 'memes'],
  },
  {
    code: 'ZA',
    label: 'South Africa',
    region: 'africa',
    trendsGeo: 'ZA',
    redditSubs: ['southafrica', 'memes'],
  },
  {
    code: 'ID',
    label: 'Indonesia',
    region: 'apac',
    trendsGeo: 'ID',
    redditSubs: ['indonesia', 'memes'],
  },
  {
    code: 'PH',
    label: 'Philippines',
    region: 'apac',
    trendsGeo: 'PH',
    redditSubs: ['Philippines', 'memes'],
  },
  {
    code: 'SG',
    label: 'Singapore',
    region: 'apac',
    trendsGeo: 'SG',
    redditSubs: ['singapore', 'memes'],
  },
  {
    code: 'MY',
    label: 'Malaysia',
    region: 'apac',
    trendsGeo: 'MY',
    redditSubs: ['malaysia', 'memes'],
  },
  {
    code: 'AU',
    label: 'Australia',
    region: 'apac',
    trendsGeo: 'AU',
    redditSubs: ['australia', 'memes'],
  },
];

export function normalizeTargetCountries(codes: string[] | null | undefined): string[] {
  const mapped = (codes || [])
    .map((c) => {
      const t = String(c || '').trim();
      if (!t) return '';
      if (t.toLowerCase() === 'worldwide') return 'worldwide';
      return t.toUpperCase();
    })
    .filter(Boolean);
  const unique = [...new Set(mapped)];
  if (!unique.length || unique.includes('worldwide')) {
    return ['worldwide'];
  }
  return unique;
}

export function resolveMarketCountries(codes: string[] | null | undefined): MarketCountry[] {
  const normalized = normalizeTargetCountries(codes);
  if (normalized.includes('worldwide')) {
    return [MARKET_COUNTRIES.find((c) => c.code === 'worldwide')!];
  }
  const found = normalized
    .map((code) => MARKET_COUNTRIES.find((c) => c.code === code))
    .filter(Boolean) as MarketCountry[];
  return found.length ? found : [MARKET_COUNTRIES.find((c) => c.code === 'worldwide')!];
}

export function countryLabels(codes: string[] | null | undefined): string {
  return resolveMarketCountries(codes)
    .map((c) => c.label)
    .join(', ');
}

/** Injected into every LLM system prompt so copy/art follow the selected geos. */
export function marketGuidanceForPrompt(codes: string[] | null | undefined): string {
  const resolved = resolveMarketCountries(codes);
  if (resolved.some((c) => c.code === 'worldwide')) {
    return [
      'Target markets: Worldwide.',
      'Write for a global English audience. Do not assume one country, currency, weekend, or public holiday unless the brief names it.',
    ].join(' ');
  }
  const labels = resolved.map((c) => c.label).join(', ');
  const gccCount = resolved.filter((c) => c.region === 'gcc').length;
  const gccNote =
    gccCount > 0
      ? ' GCC localization: Gulf English, Fri–Sat weekend, Ramadan/Eid and National Days when relevant, local currency only when a specific GCC country is implied (AED, SAR, QAR, KWD, BHD, OMR). Avoid US-only idioms and holidays.'
      : '';
  return [
    `Target markets: ${labels}.`,
    'Localize examples, holidays, spelling, CTAs, and cultural references for these countries.',
    'Do not write as if the audience is only the United States unless the United States is selected.',
    gccNote,
  ]
    .filter(Boolean)
    .join(' ');
}

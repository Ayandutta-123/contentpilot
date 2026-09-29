/**
 * Client-side mirror of API market countries (Settings picker).
 * Keep codes / labels / regions in sync with apps/api/src/lib/market-countries.ts
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

export type MarketCountryOption = {
  code: string;
  label: string;
  region: MarketRegion;
  flag: string;
};

export const GCC_CODES = ['AE', 'SA', 'QA', 'KW', 'BH', 'OM'] as const;

export const REGION_META: { id: MarketRegion; label: string; hint?: string }[] = [
  { id: 'gcc', label: 'GCC', hint: 'All six Gulf Cooperation Council states' },
  { id: 'south_asia', label: 'South Asia' },
  { id: 'middle_east', label: 'Wider Middle East' },
  { id: 'europe', label: 'Europe' },
  { id: 'americas', label: 'Americas' },
  { id: 'africa', label: 'Africa' },
  { id: 'apac', label: 'Asia-Pacific' },
];

export const MARKET_COUNTRIES: MarketCountryOption[] = [
  { code: 'worldwide', label: 'Worldwide', region: 'worldwide', flag: '🌍' },
  { code: 'AE', label: 'United Arab Emirates', region: 'gcc', flag: '🇦🇪' },
  { code: 'SA', label: 'Saudi Arabia', region: 'gcc', flag: '🇸🇦' },
  { code: 'QA', label: 'Qatar', region: 'gcc', flag: '🇶🇦' },
  { code: 'KW', label: 'Kuwait', region: 'gcc', flag: '🇰🇼' },
  { code: 'BH', label: 'Bahrain', region: 'gcc', flag: '🇧🇭' },
  { code: 'OM', label: 'Oman', region: 'gcc', flag: '🇴🇲' },
  { code: 'EG', label: 'Egypt', region: 'middle_east', flag: '🇪🇬' },
  { code: 'IN', label: 'India', region: 'south_asia', flag: '🇮🇳' },
  { code: 'PK', label: 'Pakistan', region: 'south_asia', flag: '🇵🇰' },
  { code: 'BD', label: 'Bangladesh', region: 'south_asia', flag: '🇧🇩' },
  { code: 'US', label: 'United States', region: 'americas', flag: '🇺🇸' },
  { code: 'CA', label: 'Canada', region: 'americas', flag: '🇨🇦' },
  { code: 'BR', label: 'Brazil', region: 'americas', flag: '🇧🇷' },
  { code: 'GB', label: 'United Kingdom', region: 'europe', flag: '🇬🇧' },
  { code: 'DE', label: 'Germany', region: 'europe', flag: '🇩🇪' },
  { code: 'FR', label: 'France', region: 'europe', flag: '🇫🇷' },
  { code: 'NG', label: 'Nigeria', region: 'africa', flag: '🇳🇬' },
  { code: 'ZA', label: 'South Africa', region: 'africa', flag: '🇿🇦' },
  { code: 'ID', label: 'Indonesia', region: 'apac', flag: '🇮🇩' },
  { code: 'PH', label: 'Philippines', region: 'apac', flag: '🇵🇭' },
  { code: 'SG', label: 'Singapore', region: 'apac', flag: '🇸🇬' },
  { code: 'MY', label: 'Malaysia', region: 'apac', flag: '🇲🇾' },
  { code: 'AU', label: 'Australia', region: 'apac', flag: '🇦🇺' },
];

export type MarketCountryCode = (typeof MARKET_COUNTRIES)[number]['code'];

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
  if (!unique.length || unique.includes('worldwide')) return ['worldwide'];
  return unique;
}

export function countryLabel(code: string): string {
  return MARKET_COUNTRIES.find((c) => c.code === code)?.label || code;
}

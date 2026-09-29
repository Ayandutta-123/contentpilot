import { prisma } from '../lib/prisma';
import {
  discoverMemeCandidates,
  candidatesToSignals,
} from './meme-discover.service';
import { countryLabels, normalizeTargetCountries } from '../lib/market-countries';
import {
  MEME_FORMAT_CATALOG,
  getMemeFormat,
  type MemeFormat,
} from './meme-format-catalog';

export { MEME_FORMAT_CATALOG, getMemeFormat, type MemeFormat };

export type MemeTrendSignal = {
  title: string;
  url?: string;
  snippet?: string;
};

export type PickedMemePlan = {
  format: MemeFormat;
  trendHook: string;
  trendSources: MemeTrendSignal[];
  whyThisFormat: string;
  countries: string[];
  countryLabels: string;
};

/** Search what’s culturally hot (country-scoped), then map onto our safe format catalog. */
export async function discoverMemeTrendSignals(tenantId: string): Promise<MemeTrendSignal[]> {
  const discovered = await discoverMemeCandidates(tenantId, { limit: 16 });
  return candidatesToSignals(discovered.candidates);
}

/**
 * Pick a meme format using trend signals + brand context.
 * Falls back to highest-heat formats when search is empty.
 */
export async function planTrendingBrandMeme(opts: {
  tenantId: string;
  brandContext: string;
  /** Pre-selected Memes-tab sources — skips a fresh scrape when provided */
  selectedSignals?: MemeTrendSignal[];
  preferredFormatId?: string;
  llmPick: (args: {
    formats: MemeFormat[];
    trends: MemeTrendSignal[];
    brandContext: string;
    countries: string;
  }) => Promise<{ formatId: string; trendHook: string; whyThisFormat: string }>;
}): Promise<PickedMemePlan> {
  const brand = await prisma.brandSettings.findUnique({ where: { tenantId: opts.tenantId } });
  const countries = normalizeTargetCountries(brand?.targetCountries);
  const labels = countryLabels(brand?.targetCountries);

  let trends = opts.selectedSignals?.length
    ? opts.selectedSignals
    : await discoverMemeTrendSignals(opts.tenantId);

  if (!trends.length) {
    trends = await discoverMemeTrendSignals(opts.tenantId);
  }

  const formats = [...MEME_FORMAT_CATALOG].sort((a, b) => b.heat - a.heat);

  let formatId =
    opts.preferredFormatId && formats.some((f) => f.id === opts.preferredFormatId)
      ? opts.preferredFormatId
      : formats[0]!.id;
  let trendHook =
    trends[0]?.title ||
    `Hot meme formats in ${labels} (expectation vs reality / reject-approve)`;
  let whyThisFormat = `Highest baseline engagement format for brand contrast jokes in ${labels}.`;

  try {
    const picked = await opts.llmPick({
      formats,
      trends,
      brandContext: opts.brandContext,
      countries: labels,
    });
    if (picked.formatId && formats.some((f) => f.id === picked.formatId)) {
      formatId = picked.formatId;
    }
    if (picked.trendHook?.trim()) trendHook = picked.trendHook.trim();
    if (picked.whyThisFormat?.trim()) whyThisFormat = picked.whyThisFormat.trim();
  } catch {
    // keep defaults
  }

  if (opts.preferredFormatId && formats.some((f) => f.id === opts.preferredFormatId)) {
    formatId = opts.preferredFormatId;
  }

  const format = formats.find((f) => f.id === formatId) || formats[0]!;
  return {
    format,
    trendHook,
    trendSources: trends.slice(0, 8),
    whyThisFormat,
    countries,
    countryLabels: labels,
  };
}

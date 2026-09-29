/** Brand contact / social links used on carousel closing CTA slides. */
export type BrandContactLinks = {
  websiteUrl?: string | null;
  contactEmail?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
};

export type BrandContactChip = {
  label: string;
  value: string;
};

function cleanUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '').trim();
}

function handleFromUrl(url: string, hostHint: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const path = u.pathname.replace(/\/+$/, '');
    const parts = path.split('/').filter(Boolean);
    if (parts.length) return `@${parts[parts.length - 1]}`;
    return u.hostname.replace(/^www\./, '');
  } catch {
    const m = url.match(new RegExp(`${hostHint}[^\\s/]*/(@?[\\w.-]+)`, 'i'));
    if (m?.[1]) return m[1].startsWith('@') ? m[1] : `@${m[1]}`;
    return cleanUrl(url);
  }
}

/** Build display chips only for contacts that are actually filled in. */
export function buildBrandContactChips(links: BrandContactLinks): BrandContactChip[] {
  const chips: BrandContactChip[] = [];
  const email = (links.contactEmail || '').trim();
  if (email) chips.push({ label: 'Email', value: email });

  const website = (links.websiteUrl || '').trim();
  if (website) chips.push({ label: 'Web', value: cleanUrl(website) });

  const ig = (links.instagramUrl || '').trim();
  if (ig) chips.push({ label: 'IG', value: handleFromUrl(ig, 'instagram\\.com/') });

  const li = (links.linkedinUrl || '').trim();
  if (li) chips.push({ label: 'in', value: handleFromUrl(li, 'linkedin\\.com/') });

  const fb = (links.facebookUrl || '').trim();
  if (fb) chips.push({ label: 'FB', value: handleFromUrl(fb, 'facebook\\.com/') });

  const tw = (links.twitterUrl || '').trim();
  if (tw) chips.push({ label: 'X', value: handleFromUrl(tw, '(?:twitter|x)\\.com/') });

  return chips;
}

/** Plain-text footer for LLM / closingLine fallback. */
export function formatBrandContactLine(links: BrandContactLinks): string {
  return buildBrandContactChips(links)
    .map((c) => c.value)
    .join('  ·  ');
}

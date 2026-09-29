/**
 * Neutral labels for provider IDs shown outside Settings.
 * Settings may still show real vendor names; everywhere else use these.
 */
export function providerDisplayName(
  kind: 'llm' | 'image' | 'search' | 'scrape' | 'template',
  raw?: string | null,
): string {
  const id = (raw || '').toLowerCase().trim();
  if (kind === 'llm') {
    if (!id) return 'not set';
    return 'configured';
  }
  if (kind === 'image') {
    if (!id) return 'not set';
    return 'configured';
  }
  if (kind === 'search') {
    if (!id) return 'not set';
    return 'configured';
  }
  if (kind === 'scrape') {
    return id ? 'configured' : 'not set';
  }
  if (kind === 'template') {
    if (id === 'placid') return 'Imported';
    if (id === 'inhouse' || id === 'in-house' || id === 'custom') return 'In-house';
    return id ? 'Template' : 'Template';
  }
  return 'configured';
}

export function templateProviderLabel(provider?: string | null): string {
  return providerDisplayName('template', provider);
}

/** Map internal meme/scrape source ids to neutral UI labels. */
export function sourceTriedLabel(id: string): string {
  const key = id.toLowerCase();
  if (key.includes('meme_api') || key.includes('meme-api')) return 'Meme feed';
  if (key.includes('imgflip')) return 'Meme templates';
  if (key.includes('apify')) return 'Scrape';
  if (key.includes('trend') || key.includes('google')) return 'Trends';
  if (key.includes('tavily') || key.includes('serp')) return 'Search';
  return 'Source';
}

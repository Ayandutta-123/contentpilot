'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { api } from '@/lib/api';
import { abortContentGeneration, isAbortError } from '@/lib/abort';
import { ExternalLink, Laugh, Zap, Globe2, ImageOff } from 'lucide-react';
import { BackButton, ProcessOverlay, ProcessingButton } from '@/components/ui';
import { MemeStudioDialog, type MemeStudioChoices } from '@/components/meme-studio-dialog';
import { sourceTriedLabel } from '@/lib/provider-labels';

type Candidate = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  country: string;
  countryLabel: string;
  suggestedFormatId?: string;
  publishedDate?: string;
  imageUrl?: string;
  imageUrls?: string[];
  postText?: string;
};

type BrandTpl = {
  id: string;
  name: string;
  provider?: string | null;
  backgroundUrl?: string | null;
  previewUrl?: string | null;
};
type Format = { id: string; label: string; structure: string; heat: number };
type LibraryDoc = { id: string; title: string };

type Meta = {
  templates: BrandTpl[];
  documents: LibraryDoc[];
  countries: string[];
  countryLabels: string;
  formats: Format[];
  llmProvider: string;
  imageProvider: string;
  searchProvider: string;
  hasApify: boolean;
  industry: string;
  companyName: string;
  websiteUrl: string;
  hasBrandContext: boolean;
};

function mediaUrl(url?: string | null): string {
  if (!url) return '';
  if (/^(https?:|data:)/.test(url)) return url;
  const [pathPart, query] = url.split('?');
  const encoded = pathPart
    .split('/')
    .map((seg) => {
      if (!seg) return '';
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch {
        return encodeURIComponent(seg);
      }
    })
    .join('/');
  return query ? `${encoded}?${query}` : encoded;
}

function thumbOf(c: Candidate): string {
  return c.imageUrl || c.imageUrls?.[0] || '';
}

function sourceHref(url?: string | null): string {
  const u = (url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/uploads/')) return u;
  return `https://${u.replace(/^\/+/, '')}`;
}

export default function MemesPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [providersTried, setProvidersTried] = useState<string[]>([]);
  const [primaryProvider, setPrimaryProvider] = useState('');
  const [visualCount, setVisualCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [usedBrandTemplate, setUsedBrandTemplate] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [contentId, setContentId] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const activeGenIdRef = useRef<string | null>(null);

  const selected = useMemo(
    () => candidates.find((c) => c.id === selectedId) || null,
    [candidates, selectedId],
  );

  const cancelActiveWork = async () => {
    abortRef.current?.abort();
    const genId = activeGenIdRef.current;
    activeGenIdRef.current = null;
    setDiscovering(false);
    setGenerating(false);
    if (genId) {
      try {
        await abortContentGeneration(genId);
        setOkMsg('Generation aborted.');
        setError('');
      } catch (e) {
        if (!isAbortError(e)) {
          setOkMsg('Stopped waiting. Open Approvals if a draft was already created.');
        }
      }
    } else {
      setOkMsg('Cancelled.');
      setError('');
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const [metaRes, scrapedRes] = await Promise.all([
          api<{ data: Meta }>('/content/memes/meta'),
          api<{
            data: {
              candidates: Candidate[];
              providersTried?: string[];
              primaryProvider?: string;
              visualCount?: number;
              scrapedAt?: string | null;
            };
          }>('/content/memes/scraped').catch(() => ({
            data: {
              candidates: [] as Candidate[],
              providersTried: [] as string[],
              primaryProvider: '',
              visualCount: 0,
              scrapedAt: null as string | null,
            },
          })),
        ]);
        setMeta(metaRes.data);
        if (scrapedRes.data.candidates?.length) {
          setCandidates(scrapedRes.data.candidates);
          setProvidersTried(scrapedRes.data.providersTried || []);
          setPrimaryProvider(scrapedRes.data.primaryProvider || '');
          setVisualCount(
            typeof scrapedRes.data.visualCount === 'number'
              ? scrapedRes.data.visualCount
              : scrapedRes.data.candidates.filter((c) => thumbOf(c)).length,
          );
          setOkMsg(
            `Loaded ${scrapedRes.data.candidates.length} saved meme(s) from the last scrape. Fetch again to refresh.`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
  }, []);

  const discover = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    activeGenIdRef.current = null;
    setDiscovering(true);
    setError('');
    setOkMsg('');
    setSelectedId(null);
    setStudioOpen(false);
    try {
      const res = await api<{
        data: {
          candidates: Candidate[];
          providersTried: string[];
          primaryProvider: string;
          countryLabels: string;
          visualCount?: number;
        };
      }>('/content/memes/discover', {
        method: 'POST',
        body: { limit: 24 },
        signal: ac.signal,
      });
      setCandidates(res.data.candidates);
      setProvidersTried(res.data.providersTried || []);
      setPrimaryProvider(res.data.primaryProvider || '');
      const visuals =
        typeof res.data.visualCount === 'number'
          ? res.data.visualCount
          : res.data.candidates.filter((c) => thumbOf(c)).length;
      setVisualCount(visuals);
      const withImage = res.data.candidates.find((c) => thumbOf(c));
      if (withImage) setSelectedId(withImage.id);
      else if (res.data.candidates[0]) setSelectedId(res.data.candidates[0].id);

      if (res.data.candidates.length === 0) {
        setOkMsg('No meme signals found. Check market countries in Settings → Company.');
      } else if (visuals === 0) {
        setOkMsg(
          `Found ${res.data.candidates.length} text signals but no images yet. Try again, or enable scraping in Settings → Integrations.`,
        );
      } else {
        setOkMsg(
          `Found ${visuals} visual memes for ${res.data.countryLabels}. Pick one to match its design.`,
        );
      }
    } catch (e) {
      if (isAbortError(e)) setOkMsg('Search cancelled.');
      else setError(e instanceof Error ? e.message : 'Discover failed');
    } finally {
      setDiscovering(false);
    }
  };

  const generate = async (choices: MemeStudioChoices) => {
    if (!selected) {
      setError('First scrape trending memes, then pick one visual in step 2.');
      return;
    }
    if (!thumbOf(selected)) {
      setError('Pick a meme that has an image preview so we can match its design.');
      return;
    }
    const useBrand = choices.visualMode === 'existing_template' && Boolean(choices.brandTemplateId);
    setUsedBrandTemplate(useBrand);
    setStudioOpen(false);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    activeGenIdRef.current = null;
    setGenerating(true);
    setError('');
    setOkMsg('');
    try {
      const thumb = thumbOf(selected);
      const formatGuess =
        choices.preferredFormatId || selected.suggestedFormatId || undefined;
      const res = await api<{ data: { contentId: string } }>('/content/generate', {
        method: 'POST',
        body: {
          engine: 'meme',
          useBrandTemplate: useBrand,
          brandTemplateId: useBrand ? choices.brandTemplateId : null,
          visualMode: choices.visualMode,
          contentSource: choices.contentSource,
          libraryItemId: choices.libraryItemId || undefined,
          preferredFormatId: formatGuess || undefined,
          referenceImageUrl: thumb || undefined,
          includeLogo: !useBrand,
          sources: [
            {
              title: selected.title,
              url: sourceHref(selected.url) || '',
              snippet: selected.snippet,
              publishedDate: selected.publishedDate,
              suggestedFormatId: selected.suggestedFormatId,
              imageUrl: thumb || undefined,
              imageUrls: selected.imageUrls?.length
                ? selected.imageUrls
                : thumb
                  ? [thumb]
                  : [],
              postText: selected.postText || selected.title,
            },
          ],
        },
        signal: ac.signal,
      });
      const newId = res.data.contentId;
      activeGenIdRef.current = newId;
      setContentId(newId);
      setOkMsg(
        useBrand
          ? 'Generating on your brand template, locked to the selected meme layout…'
          : 'Matching selected meme layout + brand logo/guidelines…',
      );

      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await new Promise((r) => setTimeout(r, 2500));
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const status = await api<{
          data: { status: string; headline?: string; publishError?: string | null };
        }>(`/content/${newId}`, { signal: ac.signal });
        if (status.data.status === 'pending_approval') {
          setOkMsg('Meme ready. Open Approvals to review caption, format, and image.');
          return;
        }
        if (status.data.status === 'rejected') {
          setOkMsg('Generation aborted.');
          return;
        }
        if (status.data.status === 'failed') {
          throw new Error(status.data.publishError || 'Generation failed');
        }
      }
      setOkMsg('Still generating — open Approvals; it will appear when ready.');
    } catch (e) {
      if (isAbortError(e)) setOkMsg('Generation aborted.');
      else setError(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      activeGenIdRef.current = null;
      setGenerating(false);
    }
  };

  return (
    <AuthGuard>
      <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6 animate-fade-in">
        <div className="page-header">
          <div>
            <BackButton href="/dashboard" label="Back to dashboard" className="mb-3" />
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Laugh className="text-brand-600" size={22} />
              Trending Memes
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              See viral meme visuals → pick one → we match its design with your brand logo, tone &
              guidelines.
            </p>
          </div>
        </div>

        {meta && (
          <div className="card !p-4 text-xs text-[hsl(var(--muted-foreground))] flex flex-wrap gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <Globe2 size={12} /> Markets:{' '}
              <strong className="text-[hsl(var(--foreground))]">{meta.countryLabels}</strong>
            </span>
            <span>Search: {meta.searchProvider ? 'configured' : 'not set'}</span>
            <span>Scrape boost: {meta.hasApify ? 'configured' : 'optional'}</span>
            <span>Text: {meta.llmProvider ? 'configured' : 'not set'}</span>
            <span>Image: {meta.imageProvider ? 'configured' : 'not set'}</span>
            <Link href="/settings" className="text-brand-600 underline">
              Change countries in Company
            </Link>
          </div>
        )}

        {(error || okMsg) && (
          <div
            className={`rounded-xl px-3 py-2 text-sm ${
              error ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-700'
            }`}
          >
            {error || okMsg}
            {contentId && (
              <>
                {' '}
                <Link href={`/approvals/${contentId}`} className="underline font-medium">
                  Open in Approvals
                </Link>
              </>
            )}
          </div>
        )}

        <section className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">1. Scrape trending memes</h2>
            <ProcessingButton
              loading={discovering}
              loadingText="Scraping visuals…"
              onClick={discover}
              icon={<Laugh size={16} />}
            >
              Fetch trending memes
            </ProcessingButton>
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Pulls real meme images from free sources{meta?.hasApify ? ' (plus optional scrape)' : ''} for your markets — not just news headlines.
          </p>
          {providersTried.length > 0 && (
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              Tried: {providersTried.map(sourceTriedLabel).join(' → ')}
              {primaryProvider ? ` · primary: ${sourceTriedLabel(primaryProvider)}` : ''}
              {visualCount ? ` · ${visualCount} with images` : ''}
            </p>
          )}
        </section>

        {candidates.length > 0 && (
          <section className="card space-y-4">
            <div>
              <h2 className="font-semibold">2. Choose a meme</h2>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                Click any meme to open it full-size and set up the post — content source, creative
                type, then format.
              </p>
            </div>
            <ul className="space-y-3">
              {candidates.map((c) => {
                const active = selectedId === c.id;
                const thumb = thumbOf(c);
                const href = sourceHref(c.url);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(c.id);
                        if (thumb) {
                          setError('');
                          setStudioOpen(true);
                        } else {
                          setError('This row has no image — pick one marked “has image”.');
                        }
                      }}
                      className={`flex w-full gap-3 rounded-xl border p-3 text-left transition-all ${
                        active
                          ? 'border-brand-500 bg-brand-500/5 ring-1 ring-brand-500/30'
                          : 'border-[hsl(var(--border))] hover:border-brand-500/40 hover:bg-[hsl(var(--muted))]/40'
                      }`}
                    >
                      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-800">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={mediaUrl(thumb)}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full flex-col items-center justify-center gap-1 px-1 text-center text-[10px] text-[hsl(var(--muted-foreground))]">
                            <ImageOff size={16} />
                            Topic only
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                          <span className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 capitalize">
                            {c.source.replace('_', ' ')}
                          </span>
                          <span>{c.countryLabel}</span>
                          {thumb ? (
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">
                              has image
                            </span>
                          ) : (
                            <span className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5">
                              no image
                            </span>
                          )}
                          {c.suggestedFormatId ? (
                            <span className="rounded bg-brand-500/10 px-1.5 py-0.5 text-brand-700 dark:text-brand-300">
                              {c.suggestedFormatId}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-3 text-sm font-medium leading-snug">{c.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-[hsl(var(--muted-foreground))]">
                          {c.snippet}
                        </p>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-brand-600"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Source <ExternalLink size={10} />
                          </a>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {selected && thumbOf(selected) ? (
          <div className="mobile-action-bar md:hidden">
            <ProcessingButton
              className="w-full"
              loading={generating}
              loadingText="Generating…"
              onClick={() => setStudioOpen(true)}
              icon={<Zap size={16} />}
            >
              Set up selected meme
            </ProcessingButton>
          </div>
        ) : null}
      </div>

      {selected && thumbOf(selected) ? (
        <MemeStudioDialog
          open={studioOpen}
          title={selected.title}
          imageUrl={mediaUrl(thumbOf(selected))}
          sourceLabel={`${selected.source.replace('_', ' ')} · ${selected.countryLabel}`}
          sourceHref={sourceHref(selected.url)}
          snippet={selected.snippet}
          suggestedFormatId={selected.suggestedFormatId}
          documents={meta?.documents || []}
          templates={meta?.templates || []}
          formats={meta?.formats || []}
          hasBrandContext={Boolean(meta?.hasBrandContext)}
          websiteUrl={meta?.websiteUrl || ''}
          busy={generating}
          onClose={() => setStudioOpen(false)}
          onGenerate={(choices) => void generate(choices)}
        />
      ) : null}

      <ProcessOverlay
        open={discovering || generating}
        title={discovering ? 'Scraping trending memes' : 'Matching meme design'}
        description={
          discovering
            ? 'Fetching visual meme posts for your markets…'
            : usedBrandTemplate
              ? 'Rendering on your brand template, locked to the selected meme layout…'
              : 'Reading layout from your pick, applying brand logo & tone…'
        }
        onCancel={() => void cancelActiveWork()}
        cancelLabel="Abort"
      />
    </AuthGuard>
  );
}

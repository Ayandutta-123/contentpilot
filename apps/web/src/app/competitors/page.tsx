'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { api } from '@/lib/api';
import { abortContentGeneration, isAbortError } from '@/lib/abort';
import {
  Expand, ExternalLink, Heart, MessageCircle, Radar, RefreshCw, Share2, Sparkles, X, Zap,
} from 'lucide-react';
import { BackButton, ProcessOverlay, ProcessingButton, Toggle } from '@/components/ui';
import { PlatformBadge } from '@/components/platform-badge';
import { CreativeModePicker, type CreativeVisualMode, CREATIVE_MODE_BLURBS } from '@/components/creative-mode-picker';

type ScrapedPost = {
  id: string;
  competitorId: string;
  competitorName: string;
  competitorHandle: string;
  platform: string;
  content: string;
  postUrl: string | null;
  imageUrls: string[];
  likes: number;
  commentsCount: number;
  shares: number;
  postedAt: string | null;
  createdAt: string;
  score: number;
};

type BrandTpl = { id: string; name: string; backgroundUrl?: string | null; previewUrl?: string | null };

const SCRAPE_CHANNEL_OPTS = [
  { id: 'instagram' as const, label: 'Instagram' },
  { id: 'linkedin' as const, label: 'LinkedIn' },
  { id: 'facebook' as const, label: 'Facebook' },
] as const;

type ScrapeChannelId = (typeof SCRAPE_CHANNEL_OPTS)[number]['id'];

type Meta = {
  competitorMode: 'manual' | 'auto';
  competitorImageMode: 'new_topic' | 'near_mirror';
  templates: BrandTpl[];
  competitors: Array<{
    id: string;
    name: string;
    handle: string;
    platform: string;
  }>;
  llmProvider: string;
  imageProvider: string;
  scrapingProvider: string;
  apifyConfigured: boolean;
};

function mediaUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('/api/') || url.startsWith('/uploads/') || url.startsWith('data:')) return url;
  if (/^https?:\/\//i.test(url)) {
    // Instagram / Meta CDN blocks hotlinks from our origin — go through our proxy.
    return `/api/content/image-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function PostThumb({ srcs }: { srcs?: Array<string | null | undefined> | null }) {
  const candidates = useMemo(
    () =>
      [...new Set((srcs || []).map((s) => mediaUrl(s)).filter(Boolean))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(srcs || [])],
  );
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [candidates.join('|')]);

  const resolved = candidates[idx];
  if (!resolved) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-[hsl(var(--muted-foreground))]">
        No image
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={resolved}
      src={resolved}
      alt=""
      className="h-full w-full object-cover"
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'Unknown date';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Pull unique #tags from caption text for the full-post view. */
function extractHashtags(content: string): string[] {
  if (!content) return [];
  const found = content.match(/#[\p{L}\p{N}_]+/gu) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of found) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function CompetitorPostPreviewModal({
  post,
  onClose,
  onSelect,
}: {
  post: ScrapedPost;
  onClose: () => void;
  onSelect: () => void;
}) {
  const hashtags = useMemo(() => extractHashtags(post.content || ''), [post.content]);
  const images = useMemo(
    () => [...new Set((post.imageUrls || []).map((u) => mediaUrl(u)).filter(Boolean))],
    [post.imageUrls],
  );
  const [imgIdx, setImgIdx] = useState(0);

  useEffect(() => {
    setImgIdx(0);
  }, [post.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && images.length > 1) {
        setImgIdx((i) => (i + 1) % images.length);
      }
      if (e.key === 'ArrowLeft' && images.length > 1) {
        setImgIdx((i) => (i - 1 + images.length) % images.length);
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, images.length]);

  const activeSrc = images[imgIdx];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="competitor-post-preview-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-4 py-3">
          <div className="min-w-0">
            <p id="competitor-post-preview-title" className="truncate font-semibold">
              {post.competitorName}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              <span>@{post.competitorHandle}</span>
              <PlatformBadge platform={post.platform} size="sm" />
              <span>{formatWhen(post.postedAt || post.createdAt)}</span>
              <span className="rounded bg-brand-500/10 px-1.5 py-0.5 text-brand-700 dark:text-brand-300">
                score {Math.round(post.score)}
              </span>
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost min-h-[44px] min-w-[44px] md:!min-h-[40px] md:!min-w-[40px] shrink-0 !p-2"
            onClick={onClose}
            aria-label="Close full post"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative bg-slate-950/90 dark:bg-black">
            <div className="mx-auto flex max-h-[min(52vh,420px)] min-h-[200px] items-center justify-center">
              {activeSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={activeSrc}
                  src={activeSrc}
                  alt=""
                  className="max-h-[min(52vh,420px)] w-full object-contain"
                  referrerPolicy="no-referrer"
                  onError={() => {
                    if (imgIdx < images.length - 1) setImgIdx((i) => i + 1);
                  }}
                />
              ) : (
                <p className="py-16 text-sm text-slate-400">No image on this post</p>
              )}
            </div>
            {images.length > 1 && (
              <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-2">
                {images.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Image ${i + 1}`}
                    className={`h-2 w-2 rounded-full transition ${
                      i === imgIdx ? 'bg-white' : 'bg-white/40 hover:bg-white/70'
                    }`}
                    onClick={() => setImgIdx(i)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4 px-4 py-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {post.content?.trim() || '(Media post — little or no caption)'}
            </p>

            {hashtags.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  Hashtags
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {hashtags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-brand-500/10 px-2.5 py-1 text-[12px] font-medium text-brand-700 dark:text-brand-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4 text-[12px] text-[hsl(var(--muted-foreground))]">
              <span className="inline-flex items-center gap-1.5">
                <Heart size={13} /> {post.likes}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MessageCircle size={13} /> {post.commentsCount}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Share2 size={13} /> {post.shares}
              </span>
              {post.postUrl && (
                <a
                  href={post.postUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-brand-600 hover:underline"
                >
                  <ExternalLink size={13} /> Open original
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[hsl(var(--border))] px-4 py-3">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              onSelect();
              onClose();
            }}
          >
            Select this post
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CompetitorMonitorPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [posts, setPosts] = useState<ScrapedPost[]>([]);
  const [competitorFilter, setCompetitorFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [creativeMode, setCreativeMode] = useState<CreativeVisualMode>('ai');
  const useBrand = creativeMode === 'existing_template';
  const [brandTemplateId, setBrandTemplateId] = useState('');
  const [imageMode, setImageMode] = useState<'new_topic' | 'near_mirror'>('new_topic');
  const [savingImageMode, setSavingImageMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [contentId, setContentId] = useState('');
  const [previewPost, setPreviewPost] = useState<ScrapedPost | null>(null);
  const [scrapeChannels, setScrapeChannels] = useState<ScrapeChannelId[]>([
    'instagram',
    'linkedin',
    'facebook',
  ]);
  const abortRef = useRef<AbortController | null>(null);
  const activeGenIdRef = useRef<string | null>(null);

  const selected = useMemo(
    () => posts.find((p) => p.id === selectedId) || null,
    [posts, selectedId],
  );

  const toggleScrapeChannel = (id: ScrapeChannelId) => {
    setScrapeChannels((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev; // keep at least one
        return prev.filter((p) => p !== id);
      }
      return [...prev, id];
    });
  };

  const cancelActiveWork = async () => {
    abortRef.current?.abort();
    const genId = activeGenIdRef.current;
    activeGenIdRef.current = null;
    setScraping(false);
    setGenerating(false);
    if (genId) {
      try {
        await abortContentGeneration(genId);
        setOkMsg('Generation aborted.');
        setError('');
      } catch {
        setOkMsg('Stopped waiting. Open Approvals if a draft was already created.');
      }
    } else {
      setOkMsg('Cancelled.');
      setError('');
    }
  };

  const loadPosts = useCallback(async (competitorId?: string, platforms?: string[]) => {
    const params = new URLSearchParams();
    if (competitorId) params.set('competitorId', competitorId);
    const plats = platforms?.length ? platforms : scrapeChannels;
    if (plats.length) params.set('platforms', plats.join(','));
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await api<{ data: { posts: ScrapedPost[] } }>(`/content/competitors/posts${qs}`);
    setPosts(res.data.posts);
    setSelectedId((prev) => (res.data.posts.some((p) => p.id === prev) ? prev : ''));
    setPreviewPost((prev) =>
      prev && res.data.posts.some((p) => p.id === prev.id)
        ? res.data.posts.find((p) => p.id === prev.id) || null
        : null,
    );
  }, [scrapeChannels]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const metaRes = await api<{ data: Meta }>('/content/competitors/meta');
        if (cancelled) return;
        setMeta(metaRes.data);
        if (metaRes.data.templates[0]) {
          setBrandTemplateId(metaRes.data.templates[0].id);
        }
        setImageMode(
          metaRes.data.competitorImageMode === 'near_mirror' ? 'near_mirror' : 'new_topic',
        );
        // Brand template is opt-in — default Full AI so posts get AI images, not plate chrome
        setCreativeMode('ai');
        await loadPosts();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Initial load only — channel filter reloads via scrapeChannels effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) return;
    void loadPosts(competitorFilter || undefined).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrapeChannels]);

  const scrapeChannelPicker = (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
        Scrape channels — only networks with a saved URL on each competitor are hit
      </p>
      <div className="flex flex-wrap gap-2">
        {SCRAPE_CHANNEL_OPTS.map((opt) => {
          const on = scrapeChannels.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggleScrapeChannel(opt.id)}
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-2.5 py-1.5 transition ${
                on
                  ? 'border-brand-500/40 bg-brand-500/10 shadow-sm'
                  : 'border-[hsl(var(--border))] opacity-55 hover:opacity-90'
              }`}
            >
              <PlatformBadge platform={opt.id} size="sm" variant={on ? 'solid' : 'pill'} />
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide ${
                  on ? 'text-brand-700 dark:text-brand-300' : 'text-[hsl(var(--muted-foreground))]'
                }`}
              >
                {on ? 'On' : 'Off'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const saveImageMode = async (mode: 'new_topic' | 'near_mirror') => {
    setImageMode(mode);
    setSavingImageMode(true);
    try {
      await api('/settings/providers', {
        method: 'PUT',
        body: { competitorImageMode: mode },
      });
      setMeta((m) => (m ? { ...m, competitorImageMode: mode } : m));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save image style');
    } finally {
      setSavingImageMode(false);
    }
  };

  const scrape = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    activeGenIdRef.current = null;
    setScraping(true);
    setError('');
    setOkMsg('Starting competitor scrape…');
    try {
      const start = await api<{
        data: { jobId: string; status: string; message: string };
      }>('/content/competitors/scrape', {
        method: 'POST',
        body: {
          ...(competitorFilter ? { competitorId: competitorFilter } : {}),
          platforms: scrapeChannels,
        },
        signal: ac.signal,
      });

      const jobId = start.data.jobId;
      setOkMsg(start.data.message || 'Competitor scrape running…');

      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await new Promise((r) => setTimeout(r, 3000));
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const status = await api<{
          data: {
            status: 'running' | 'succeeded' | 'failed';
            message: string;
            scraped?: number;
            competitors?: number;
            errors?: string[];
            error?: string;
            posts?: ScrapedPost[];
            creditAlert?: unknown;
          };
        }>(`/content/competitors/scrape/${jobId}`, { signal: ac.signal });

        setOkMsg(status.data.message);

        if (status.data.status === 'succeeded') {
          if (status.data.posts) setPosts(status.data.posts);
          else await loadPosts(competitorFilter || undefined);
          const errNote =
            status.data.errors && status.data.errors.length
              ? ` Warnings: ${status.data.errors.join(' · ')}`
              : '';
          setOkMsg(
            (status.data.scraped != null
              ? `Scraped ${status.data.scraped} new post(s) from ${status.data.competitors ?? 0} competitor(s).`
              : status.data.message) + errNote,
          );
          return;
        }

        if (status.data.status === 'failed') {
          if (status.data.posts?.length) setPosts(status.data.posts);
          if (status.data.creditAlert) {
            // Recharge modal comes from api meta — avoid duplicating a red banner.
            setError('');
            setOkMsg('');
            return;
          }
          throw new Error(status.data.error || status.data.message || 'Scrape failed');
        }
      }
      throw new Error(
        'Scrape timed out after 5 minutes. Try again, or scrape one competitor at a time.',
      );
    } catch (e) {
      if (isAbortError(e)) {
        setOkMsg('Scrape cancelled.');
        setError('');
      } else {
        setError(e instanceof Error ? e.message : 'Scrape failed');
        setOkMsg('');
      }
    } finally {
      setScraping(false);
    }
  };

  const generateFromSelected = async () => {
    if (!selected) {
      setError('Choose one competitor post first');
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    activeGenIdRef.current = null;
    setGenerating(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{ data: { contentId: string } }>('/content/generate', {
        method: 'POST',
        body: {
          engine: 'competitor',
          scrapedPostId: selected.id,
          competitorId: selected.competitorId,
          refreshScrape: false,
          useBrandTemplate: useBrand && Boolean(brandTemplateId),
          brandTemplateId: useBrand ? brandTemplateId : null,
          visualMode: creativeMode,
          competitorImageMode: imageMode,
        },
        signal: ac.signal,
      });
      const newId = res.data.contentId;
      activeGenIdRef.current = newId;
      setContentId(newId);
      setOkMsg('Creating brand-styled post…');
      const deadline = Date.now() + 3 * 60 * 1000;
      while (Date.now() < deadline) {
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await new Promise((r) => setTimeout(r, 2500));
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const status = await api<{
          data: { status: string; publishError?: string | null };
        }>(`/content/${newId}`, { signal: ac.signal });
        if (status.data.status === 'pending_approval') {
          setOkMsg('Post ready. Review it in Approvals.');
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
      setOkMsg('Still generating — open Approvals when ready.');
    } catch (e) {
      if (isAbortError(e)) setOkMsg('Generation aborted.');
      else setError(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      activeGenIdRef.current = null;
      setGenerating(false);
    }
  };

  const runAuto = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    activeGenIdRef.current = null;
    setGenerating(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{ data: { contentId: string } }>('/content/generate', {
        method: 'POST',
        body: {
          engine: 'competitor',
          competitorId: competitorFilter || undefined,
          refreshScrape: true,
          useBrandTemplate: useBrand && Boolean(brandTemplateId),
          brandTemplateId: useBrand ? brandTemplateId : null,
          visualMode: creativeMode,
          competitorImageMode: imageMode,
          platforms: scrapeChannels,
        },
        signal: ac.signal,
      });
      const newId = res.data.contentId;
      activeGenIdRef.current = newId;
      setContentId(newId);
      setOkMsg('Auto mode running…');
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await new Promise((r) => setTimeout(r, 2500));
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const status = await api<{
          data: { status: string; publishError?: string | null };
        }>(`/content/${newId}`, { signal: ac.signal });
        if (status.data.status === 'pending_approval') {
          setOkMsg('Post ready. Review it in Approvals.');
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
      setOkMsg('Still generating — open Approvals when ready.');
    } catch (e) {
      if (isAbortError(e)) setOkMsg('Generation aborted.');
      else setError(e instanceof Error ? e.message : 'Failed');
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
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Radar className="text-brand-600" size={22} />
              Competitor Monitor
            </h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Scrape competitor posts → choose one (or auto-pick the best) → create similar content,
              hashtags, and images matched to your brand style.
            </p>
          </div>
        </div>

        {meta && (
          <div className="card !p-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">
            <span>
              Mode:{' '}
              <strong className="text-[hsl(var(--foreground))]">{meta.competitorMode}</strong>
              {' · '}
              Image:{' '}
              <strong className="text-[hsl(var(--foreground))]">
                {meta.competitorImageMode === 'near_mirror' ? 'exact scraped' : 'new topic'}
              </strong>
            </span>
            <span>Scrape: {meta.apifyConfigured ? 'connected' : 'not set'}</span>
            <span>Text: {meta.llmProvider ? 'configured' : 'not set'}</span>
            <span>Image: {meta.imageProvider ? 'configured' : 'not set'}</span>
            <span>Competitors: {meta.competitors.length}</span>
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
                <Link href={`/approvals/${contentId}`} className="font-medium underline">
                  Open in Approvals
                </Link>
              </>
            )}
          </div>
        )}

        <section className="card space-y-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Sparkles size={16} /> Competitor image style
          </h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Same default as Settings → Integrations. Applies to manual create, auto run, and scheduled
            competitor automation.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  id: 'new_topic' as const,
                  label: 'New topic image',
                  hint: useBrand
                    ? 'AI photo into the template picture zones — not their scraped photo'
                    : 'Fresh AI photo from the caption — not based on their picture',
                },
                {
                  id: 'near_mirror' as const,
                  label: 'Exact scraped image',
                  hint: useBrand
                    ? 'That post’s photo goes into the template picture zones (no AI art)'
                    : 'Reuse that post’s photo as-is (no new AI image)',
                },
              ] as const
            ).map((opt) => {
              const active = imageMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={savingImageMode}
                  onClick={() => void saveImageMode(opt.id)}
                  className={`text-left rounded-xl border px-3.5 py-3 transition-all ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                      : 'border-slate-200 bg-white hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900'
                  }`}
                >
                  <span className="text-sm font-semibold">{opt.label}</span>
                  <p
                    className={`mt-0.5 text-[11px] ${
                      active ? 'text-slate-300 dark:text-slate-600' : 'text-[hsl(var(--muted-foreground))]'
                    }`}
                  >
                    {opt.hint}
                  </p>
                </button>
              );
            })}
          </div>
          {savingImageMode && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Saving default…</p>
          )}
        </section>

        <section className="card space-y-4">
          <CreativeModePicker
            value={creativeMode}
            onChange={setCreativeMode}
            brandTemplatesCount={meta?.templates.length || 0}
          />
          {useBrand && meta && meta.templates.length > 0 && (
            <select
              className="input"
              value={brandTemplateId}
              onChange={(e) => setBrandTemplateId(e.target.value)}
            >
              {meta.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          {creativeMode === 'ai' && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {CREATIVE_MODE_BLURBS.ai}
            </p>
          )}
          {creativeMode === 'ai_baked_layout' && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {CREATIVE_MODE_BLURBS.ai_baked_layout}
            </p>
          )}
        </section>

        {meta?.competitorMode === 'auto' ? (
          <section className="card space-y-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <Zap size={16} /> Auto competitor post
            </h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Scrapes added competitors, scores posts by engagement + freshness, picks the best one,
              then writes similar-type hashtags, copy, and images in your brand style.
            </p>
            {scrapeChannelPicker}
            {meta.competitors.length > 0 && (
              <label className="block space-y-1">
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  Limit to one competitor (optional)
                </span>
                <select
                  className="input"
                  value={competitorFilter}
                  onChange={(e) => setCompetitorFilter(e.target.value)}
                >
                  <option value="">All competitors</option>
                  {meta.competitors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.platform}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ProcessingButton
              loading={generating}
              loadingText="Running competitor pipeline…"
              icon={<Zap size={14} />}
              onClick={() => void runAuto()}
              disabled={
                !meta.competitors.length ||
                !meta.apifyConfigured ||
                scrapeChannels.length === 0
              }
            >
              Run Competitor Monitor
            </ProcessingButton>
            {!meta.apifyConfigured && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Connect scraping in Settings → Integrations first.
              </p>
            )}
            {!meta.competitors.length && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Add competitors in Settings → Competitors first.
              </p>
            )}
          </section>
        ) : (
          <>
            <section className="card space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 font-semibold">
                    <RefreshCw size={16} /> 1. Refresh scraped posts
                  </h2>
                  <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                    Pull latest posts from every saved channel you turn on below (Instagram,
                    LinkedIn, Facebook). Images are cached so thumbnails stay stable.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {meta && meta.competitors.length > 0 && (
                    <select
                      className="input min-h-[44px] md:!min-h-[40px] !w-auto text-sm"
                      value={competitorFilter}
                      onChange={(e) => {
                        const id = e.target.value;
                        setCompetitorFilter(id);
                        void loadPosts(id || undefined).catch((err) =>
                          setError(err instanceof Error ? err.message : 'Load failed'),
                        );
                      }}
                    >
                      <option value="">All competitors</option>
                      {meta.competitors.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <ProcessingButton
                    loading={scraping}
                    loadingText="Scraping…"
                    icon={<RefreshCw size={14} />}
                    onClick={() => void scrape()}
                    disabled={
                      !meta?.apifyConfigured ||
                      !meta?.competitors.length ||
                      scrapeChannels.length === 0
                    }
                  >
                    Scrape now
                  </ProcessingButton>
                </div>
              </div>
              {scrapeChannelPicker}
            </section>

            <section className="card space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-semibold">2. Choose a post</h2>
                  <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                    Ranked by engagement score — likes + comments×3 + shares×2, plus a freshness
                    boost for posts under 48 hours. Click a card to preview the full caption and
                    image.
                  </p>
                </div>
                {posts.length > 0 && (
                  <p className="text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
                    {posts.length} ranked
                    {selected ? ' · 1 selected' : ''}
                  </p>
                )}
              </div>
              {loading ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading posts…</p>
              ) : posts.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  No scraped posts yet. Click <strong>Scrape now</strong>, or generate once from
                  Dashboard to seed history.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {posts.map((post, index) => {
                    const active = selectedId === post.id;
                    const rank = index + 1;
                    return (
                      <li key={post.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setSelectedId(post.id);
                            setPreviewPost(post);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedId(post.id);
                              setPreviewPost(post);
                            }
                          }}
                          className={`group relative flex w-full cursor-pointer gap-3.5 overflow-hidden rounded-2xl border p-3 text-left transition-all duration-200 sm:p-3.5 ${
                            active
                              ? 'border-brand-500/60 bg-gradient-to-br from-brand-500/[0.08] to-transparent shadow-md shadow-brand-600/10 ring-1 ring-brand-500/25'
                              : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:-translate-y-0.5 hover:border-brand-500/35 hover:shadow-lg hover:shadow-brand-600/5'
                          }`}
                        >
                          <div
                            className={`absolute inset-y-3 left-0 w-0.5 rounded-full transition-opacity ${
                              active ? 'bg-brand-500 opacity-100' : 'bg-brand-500/40 opacity-0 group-hover:opacity-100'
                            }`}
                            aria-hidden
                          />
                          <div className="relative h-[5.5rem] w-[5.5rem] shrink-0 overflow-hidden rounded-xl bg-slate-200 shadow-inner dark:bg-slate-800 sm:h-24 sm:w-24">
                            <PostThumb srcs={post.imageUrls} />
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/50 via-transparent to-transparent opacity-80" />
                            <span className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-md bg-slate-950/70 px-1.5 text-[10px] font-semibold tabular-nums text-white backdrop-blur-sm">
                              #{rank}
                            </span>
                            <span className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-md bg-white/90 px-1.5 py-0.5 text-[9px] font-semibold text-slate-800 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:bg-slate-900/90 dark:text-slate-100">
                              <Expand size={9} /> Preview
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                              <span className="text-sm font-semibold tracking-tight text-[hsl(var(--foreground))]">
                                {post.competitorName}
                              </span>
                              <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                                @{post.competitorHandle}
                              </span>
                              <PlatformBadge platform={post.platform} size="sm" />
                              <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                                {formatWhen(post.postedAt || post.createdAt)}
                              </span>
                              <span
                                className="ml-auto inline-flex items-center gap-1 rounded-full border border-brand-500/20 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-brand-800 dark:text-brand-200"
                                title="likes + comments×3 + shares×2 + freshness (posts under 48h)"
                              >
                                <Zap size={10} className="opacity-70" />
                                {Math.round(post.score)}
                              </span>
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-[hsl(var(--foreground))]/90 sm:line-clamp-3">
                              {post.content || '(Media post — little or no caption)'}
                            </p>
                            <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                              <span className="inline-flex items-center gap-1 tabular-nums">
                                <Heart size={12} className="opacity-70" /> {post.likes}
                              </span>
                              <span className="inline-flex items-center gap-1 tabular-nums">
                                <MessageCircle size={12} className="opacity-70" />{' '}
                                {post.commentsCount}
                              </span>
                              <span className="inline-flex items-center gap-1 tabular-nums">
                                <Share2 size={12} className="opacity-70" /> {post.shares}
                              </span>
                              {post.postUrl && (
                                <a
                                  href={post.postUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-300"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink size={11} /> Original
                                </a>
                              )}
                              {active && (
                                <span className="ml-auto rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                                  Selected
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="card space-y-3">
              <h2 className="font-semibold">3. Create similar post</h2>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                AI mirrors the post type (offer, tip, launch, etc.) and hashtag energy, then rewrites
                everything in your brand voice
                {useBrand ? ' onto your Brand Studio template' : ''}. Image:{' '}
                {imageMode === 'near_mirror'
                  ? useBrand
                    ? 'exact scraped photo placed in the template picture zones'
                    : 'exact scraped photo from that post'
                  : useBrand
                    ? 'new AI photo in the template picture zones'
                    : 'new topic photo from the caption'}
                .
              </p>
              <ProcessingButton
                className="w-full sm:w-auto"
                loading={generating}
                loadingText="Creating brand-styled post…"
                icon={<Sparkles size={14} />}
                onClick={() => void generateFromSelected()}
                disabled={!selected}
              >
                Create post from selected
              </ProcessingButton>
            </section>
            {selected ? (
              <div className="mobile-action-bar md:hidden">
                <ProcessingButton
                  className="w-full"
                  loading={generating}
                  loadingText="Creating…"
                  icon={<Sparkles size={14} />}
                  onClick={() => void generateFromSelected()}
                >
                  Create post from selected
                </ProcessingButton>
              </div>
            ) : null}
          </>
        )}

        <ProcessOverlay
          open={scraping || generating}
          title={scraping ? 'Scraping competitors…' : 'Generating brand-styled post…'}
          description={
            scraping
              ? 'This usually takes 1–3 minutes. You can leave this tab open — we poll until the scrape finishes.'
              : 'Matching content type, hashtags, and visuals to your brand — then sending to Approvals.'
          }
          onCancel={() => void cancelActiveWork()}
          cancelLabel="Abort"
        />

        {previewPost && (
          <CompetitorPostPreviewModal
            post={previewPost}
            onClose={() => setPreviewPost(null)}
            onSelect={() => setSelectedId(previewPost.id)}
          />
        )}
      </div>
    </AuthGuard>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { api } from '@/lib/api';
import { abortContentGeneration, isAbortError } from '@/lib/abort';
import {
  ExternalLink, Newspaper, Sparkles, Zap,
} from 'lucide-react';
import { BackButton, ProcessOverlay, ProcessingButton, RangeSlider, Toggle } from '@/components/ui';
import { CreativeModePicker, type CreativeVisualMode, CREATIVE_MODE_BLURBS, CREATIVE_MODE_LABELS } from '@/components/creative-mode-picker';

type Candidate = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  topicId: string;
  topicName: string;
  imageUrl?: string;
};

type BrandTpl = { id: string; name: string; backgroundUrl?: string | null; previewUrl?: string | null };

type Meta = {
  trendsMode: 'manual' | 'auto';
  templates: BrandTpl[];
  topics: Array<{ id: string; name: string }>;
  llmProvider: string;
  imageProvider: string;
  searchProvider: string;
};

type DiscoverJobStatus = {
  status: 'running' | 'succeeded' | 'failed';
  message: string;
  days: number;
  completedTopics: number;
  totalTopics: number;
  currentTopicName?: string;
  candidates: Candidate[];
  topicErrors?: string[];
  error?: string;
  creditAlert?: {
    tool: string;
    toolLabel: string;
    title: string;
    message: string;
    billingUrl: string;
  };
};

export default function TrendsPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [days, setDays] = useState(7);
  const [selected, setSelected] = useState<Record<string, Candidate>>({});
  const [creativeMode, setCreativeMode] = useState<CreativeVisualMode>('ai');
  const [brandTemplateId, setBrandTemplateId] = useState('');
  const useBrand = creativeMode === 'existing_template';
  const [discovering, setDiscovering] = useState(false);
  const [discoverProgress, setDiscoverProgress] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [contentId, setContentId] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const activeGenIdRef = useRef<string | null>(null);
  const discoverJobIdRef = useRef<string | null>(null);

  const selectedList = useMemo(() => Object.values(selected), [selected]);

  const cancelActiveWork = async () => {
    abortRef.current?.abort();
    const genId = activeGenIdRef.current;
    activeGenIdRef.current = null;
    const discoverJobId = discoverJobIdRef.current;
    discoverJobIdRef.current = null;
    setDiscovering(false);
    setGenerating(false);
    setDiscoverProgress('');

    if (discoverJobId) {
      try {
        const res = await api<{ data: { candidates?: Candidate[]; message?: string } }>(
          `/content/trends/discover/${discoverJobId}/cancel`,
          { method: 'POST' },
        );
        if (res.data.candidates?.length) {
          setCandidates(res.data.candidates);
          setOkMsg(
            `Search stopped. Showing ${res.data.candidates.length} article(s) found so far.`,
          );
          setError('');
        } else {
          setOkMsg('Search cancelled.');
          setError('');
        }
      } catch {
        setOkMsg('Search cancelled.');
        setError('');
      }
      return;
    }

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
          api<{ data: Meta }>('/content/trends/meta'),
          api<{ data: { candidates: Candidate[]; scrapedAt?: string | null } }>(
            '/content/trends/scraped',
          ).catch(() => ({ data: { candidates: [] as Candidate[], scrapedAt: null } })),
        ]);
        setMeta(metaRes.data);
        if (metaRes.data.templates[0]) {
          setBrandTemplateId(metaRes.data.templates[0].id);
        }
        // Opt-in only — default Full AI, no Brand Studio plate
        setCreativeMode('ai');
        if (scrapedRes.data.candidates?.length) {
          setCandidates(scrapedRes.data.candidates);
          setOkMsg(
            `Loaded ${scrapedRes.data.candidates.length} saved article(s) from the last scrape. Search again to refresh.`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
  }, []);

  const applyDiscoverResult = (data: DiscoverJobStatus) => {
    if (data.candidates?.length) {
      setCandidates(data.candidates);
      setSelected({});
    }
    if (typeof data.days === 'number') setDays(data.days);

    const topicsTouched = new Set(data.candidates.map((c) => c.topicId)).size;
    if (data.creditAlert) {
      // Recharge modal is shown via api.ts meta.creditAlert — keep a short page note only.
      if (data.candidates.length > 0) {
        setOkMsg(
          `Showing ${data.candidates.length} article(s) found before search credits ran out.`,
        );
      } else {
        setOkMsg('');
      }
      setError('');
      return;
    }

    if (data.status === 'succeeded') {
      setError('');
      if (data.candidates.length === 0) {
        setOkMsg(
          data.message ||
            'No articles found for the last 7 days. Check Topics and search key in Settings.',
        );
      } else {
        setOkMsg(
          data.message ||
            `Found ${data.candidates.length} article(s) across ${topicsTouched || data.totalTopics} topic(s).`,
        );
      }
      return;
    }

    // failed / partial / cancelled — still keep whatever was scraped
    if (data.candidates.length > 0) {
      setOkMsg(
        `Showing ${data.candidates.length} article(s) from ${topicsTouched} topic(s) that completed.`,
      );
      setError(data.error || data.message || 'Search finished with errors.');
    } else {
      setOkMsg('');
      setError(data.error || data.message || 'Discover failed');
    }
  };

  const discover = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    activeGenIdRef.current = null;
    discoverJobIdRef.current = null;
    setDiscovering(true);
    setError('');
    setOkMsg('');
    setSelected({});
    setCandidates([]);
    setDiscoverProgress('Starting search across all topics…');
    try {
      const start = await api<{
        data: { jobId: string; status: string; message: string; days: number };
      }>('/content/trends/discover', {
        method: 'POST',
        body: { days, perTopic: 5 },
        signal: ac.signal,
      });

      const jobId = start.data.jobId;
      discoverJobIdRef.current = jobId;
      setDiscoverProgress(start.data.message || 'Searching…');

      // Large topic lists (70+) can take 10–20+ minutes; short polls keep the proxy alive.
      const deadline = Date.now() + 30 * 60 * 1000;
      while (Date.now() < deadline) {
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await new Promise((r) => setTimeout(r, 2000));
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const status = await api<{ data: DiscoverJobStatus }>(
          `/content/trends/discover/${jobId}`,
          { signal: ac.signal },
        );

        const d = status.data;
        const progress =
          d.totalTopics > 0
            ? `Topic ${d.completedTopics}/${d.totalTopics}${d.currentTopicName ? `: ${d.currentTopicName}` : ''} · ${d.candidates.length} article(s)`
            : d.message;
        setDiscoverProgress(progress);
        // Live-update list so partial results appear while still running
        if (d.candidates.length) setCandidates(d.candidates);

        if (d.status === 'succeeded' || d.status === 'failed') {
          applyDiscoverResult(d);
          return;
        }
      }
      setError(
        'Search is still running longer than expected. Articles found so far are listed below — refresh or try again later.',
      );
      try {
        const last = await api<{ data: DiscoverJobStatus }>(`/content/trends/discover/${jobId}`);
        if (last.data.candidates.length) setCandidates(last.data.candidates);
        if (last.data.status !== 'running') applyDiscoverResult(last.data);
      } catch {
        /* keep banner */
      }
    } catch (e) {
      if (isAbortError(e)) {
        // Overlay Abort owns messaging + partial results via cancel endpoint.
      } else {
        setError(e instanceof Error ? e.message : 'Discover failed');
      }
    } finally {
      discoverJobIdRef.current = null;
      setDiscovering(false);
      setDiscoverProgress('');
    }
  };

  const toggle = (c: Candidate) => {
    setSelected((prev) => {
      // Key strictly by unique candidate id (sha256-based from API).
      const next: Record<string, Candidate> = { ...prev };
      if (next[c.id]) {
        delete next[c.id];
      } else {
        next[c.id] = c;
      }
      return next;
    });
  };

  const generate = async () => {
    if (selectedList.length === 0) {
      setError('First fetch news, then select at least one source in step 2.');
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
      const primary = selectedList[0];
      const res = await api<{ data: { contentId: string } }>('/content/generate', {
        method: 'POST',
        body: {
          engine: 'trends',
          topicId: primary.topicId,
          useBrandTemplate: useBrand && Boolean(brandTemplateId),
          brandTemplateId: useBrand ? brandTemplateId : null,
          visualMode: creativeMode,
          sources: selectedList.map((s) => ({
            title: s.title,
            url: s.url,
            snippet: s.snippet,
            publishedDate: s.publishedDate,
            topicId: s.topicId,
            topicName: s.topicName,
            ...(s.imageUrl ? { imageUrl: s.imageUrl } : {}),
          })),
        },
        signal: ac.signal,
      });
      const newId = res.data.contentId;
      activeGenIdRef.current = newId;
      setContentId(newId);
      setOkMsg('Writing caption, hashtags, and image…');

      const deadline = Date.now() + 3 * 60 * 1000;
      while (Date.now() < deadline) {
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await new Promise((r) => setTimeout(r, 2500));
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const status = await api<{
          data: { status: string; headline?: string; publishError?: string | null };
        }>(`/content/${newId}`, { signal: ac.signal });
        if (status.data.status === 'pending_approval') {
          setOkMsg('Post ready with caption & hashtags. Open Approvals to review, edit, or publish.');
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
      if (isAbortError(e)) {
        setOkMsg('Generation aborted.');
      } else {
        setError(e instanceof Error ? e.message : 'Generate failed');
      }
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
          engine: 'trends',
          useBrandTemplate: useBrand && Boolean(brandTemplateId),
          brandTemplateId: useBrand ? brandTemplateId : null,
          visualMode: creativeMode,
        },
        signal: ac.signal,
      });
      const newId = res.data.contentId;
      activeGenIdRef.current = newId;
      setContentId(newId);
      setOkMsg('Auto Trends running…');
      const deadline = Date.now() + 3 * 60 * 1000;
      while (Date.now() < deadline) {
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await new Promise((r) => setTimeout(r, 2500));
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const status = await api<{
          data: { status: string; publishError?: string | null };
        }>(`/content/${newId}`, { signal: ac.signal });
        if (status.data.status === 'pending_approval') {
          setOkMsg('Post ready. Open Approvals to review caption, hashtags, and image.');
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
      if (isAbortError(e)) {
        setOkMsg('Generation aborted.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed');
      }
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
              <Newspaper className="text-brand-600" size={22} />
              Industry Trends
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              Past {days} days news → choose sources → create post (brand template optional) → edit → publish to connected channels.
            </p>
          </div>
        </div>

        {meta && (
          <div className="card !p-4 text-xs text-[hsl(var(--muted-foreground))] flex flex-wrap gap-x-4 gap-y-1">
            <span>Mode: <strong className="text-[hsl(var(--foreground))]">{meta.trendsMode}</strong> (Settings → Integrations)</span>
            <span>Search: {meta.searchProvider ? 'configured' : 'not set'}</span>
            <span>Text: {meta.llmProvider ? 'configured' : 'not set'}</span>
            <span>Image: {meta.imageProvider ? 'configured' : 'not set'}</span>
            <span>Topics: {meta.topics.length}</span>
          </div>
        )}

        {(error || okMsg) && (
          <div className="space-y-2">
            {okMsg && (
              <div className="rounded-xl px-3 py-2 text-sm bg-emerald-500/10 text-emerald-700">
                {okMsg}
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
            {error && (
              <div className="rounded-xl px-3 py-2 text-sm bg-red-500/10 text-red-600">
                {error}
              </div>
            )}
          </div>
        )}

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
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          {!meta?.templates.length && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              No templates yet — use {CREATIVE_MODE_LABELS.ai} or{' '}
              {CREATIVE_MODE_LABELS.ai_baked_layout}. Create plates in{' '}
              <Link href="/brand-studio" className="text-brand-600 underline">Brand Studio</Link>.
            </p>
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

        {meta?.trendsMode === 'auto' ? (
          <section className="card space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Zap size={16} /> Auto mode
            </h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Uses the next rotated topic from Settings, search for last-7-day news, then your configured text and image models (or brand template if checked).
              Result goes to Approvals for edit and channel publish.
            </p>
            <ProcessingButton loading={generating} loadingText="Running Trends workflow…" onClick={runAuto} icon={<Zap size={16} />}>
              Run Industry Trends (auto)
            </ProcessingButton>
          </section>
        ) : (
          <>
            <section className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">1. Discover last {days} days news</h2>
                <ProcessingButton
                  loading={discovering}
                  loadingText="Searching sources…"
                  onClick={discover}
                  icon={<Newspaper size={16} />}
                >
                  Fetch industry news
                </ProcessingButton>
              </div>
              <RangeSlider
                label="Freshness window"
                value={days}
                min={1}
                max={30}
                suffix=" days"
                onChange={setDays}
                description="Shorter windows prioritize breaking news; longer windows return more sources."
              />
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Searches each active Settings topic via your configured search provider. Large topic lists run in the background so all topics can finish.
              </p>
            </section>

            {candidates.length > 0 && (
              <section className="card !p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
                  <h2 className="font-semibold text-sm">2. Choose sources ({selectedList.length} selected)</h2>
                </div>
                <ul className="divide-y divide-[hsl(var(--border))] max-h-[420px] overflow-y-auto">
                  {candidates.map((c) => {
                    const on = Boolean(selected[c.id]);
                    return (
                      <li key={c.id}>
                        <label
                          htmlFor={`trend-src-${c.id}`}
                          className={`flex min-h-[56px] gap-3 px-4 py-3.5 cursor-pointer hover:bg-[hsl(var(--muted))]/50 ${on ? 'bg-brand-600/5' : ''}`}
                        >
                          <input
                            id={`trend-src-${c.id}`}
                            type="checkbox"
                            className="mt-1.5 h-5 w-5 shrink-0 accent-brand-600"
                            checked={on}
                            onChange={() => toggle(c)}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-snug">{c.title}</p>
                            <p className="text-[11px] text-brand-600 mt-0.5">{c.topicName}</p>
                            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 line-clamp-2">{c.snippet}</p>
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-brand-600 mt-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Source <ExternalLink size={10} />
                            </a>
                            {c.publishedDate && (
                              <span className="text-[10px] text-[hsl(var(--muted-foreground))] ml-2">{c.publishedDate}</span>
                            )}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <section className="card space-y-3">
              <h2 className="font-semibold">3. Create post</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {selectedList.length === 0
                  ? 'Fetch news (step 1), check sources in step 2, then generate. Caption + hashtags appear in Approvals.'
                  : 'Creates caption, hashtags, and image, then opens for review in Approvals (Post / Reject / edit until published).'}
              </p>
              <div className="mobile-action-bar !static !mx-0 !border-0 !bg-transparent !p-0 !shadow-none md:!static">
                <ProcessingButton
                  className="w-full sm:w-auto"
                  loading={generating}
                  loadingText="Generating caption & hashtags…"
                  disabled={selectedList.length === 0}
                  onClick={generate}
                  icon={<Zap size={16} />}
                >
                  Generate social post
                  {selectedList.length > 0 ? ` (${selectedList.length})` : ''}
                </ProcessingButton>
              </div>
            </section>
            {selectedList.length > 0 && (
              <div className="mobile-action-bar md:hidden">
                <ProcessingButton
                  className="w-full"
                  loading={generating}
                  loadingText="Generating…"
                  onClick={generate}
                  icon={<Zap size={16} />}
                >
                  Generate ({selectedList.length})
                </ProcessingButton>
              </div>
            )}
          </>
        )}
      </div>
      <ProcessOverlay
        open={discovering || generating}
        title={discovering ? 'Searching industry news' : 'Generating social post'}
        description={
          discovering
            ? discoverProgress || 'Pulling fresh sources for your topics…'
            : 'Writing caption and preparing the image pipeline…'
        }
        onCancel={() => void cancelActiveWork()}
        cancelLabel="Abort"
      />
    </AuthGuard>
  );
}

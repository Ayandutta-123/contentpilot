'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { api, apiUpload } from '@/lib/api';
import { abortContentGeneration, isAbortError } from '@/lib/abort';
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  ImagePlus,
  Layers,
  MessageSquare,
  Paperclip,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  BackButton,
  InlineNotice,
  ProcessOverlay,
  ProcessingButton,
  WorkflowStepper,
} from '@/components/ui';
import { PlatformBadge, PlatformBadgeList } from '@/components/platform-badge';

type Meta = {
  companyName: string;
  industry: string;
  brandType: string;
  minSlides: number;
  maxSlides: number;
  defaultSlides: number;
  llmProvider: string;
  imageProvider: string;
  note: string;
};

type Attachment = {
  id: string;
  fileName: string;
  kind: 'pdf' | 'text' | 'image' | 'spreadsheet';
  extractedText: string;
  charCount: number;
  previewUrl?: string;
};

const PLATFORM_OPTS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'twitter', label: 'X / Twitter' },
] as const;

const ACCEPT =
  'application/pdf,text/plain,text/markdown,text/csv,.pdf,.txt,.md,.csv,.xlsx,.xls,image/png,image/jpeg,image/webp,image/gif';

const TOPIC_HINTS = [
  '4 ways our platform cuts onboarding time',
  'How we co-build full-stack IoT ventures',
  'Proof points from our latest product release',
];

function slideHintFor(n: number): string {
  if (n <= 2) return 'Hook + close';
  if (n === 3) return 'Hook → proof → CTA';
  if (n === 4) return 'Hook → 2 proof → CTA';
  if (n <= 6) return 'Hook → proof chain → CTA';
  return 'Long story arc → close';
}

function formatChars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export default function CarouselPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [topic, setTopic] = useState('');
  const [slideCount, setSlideCount] = useState(3);
  const [platforms, setPlatforms] = useState<string[]>(['instagram', 'linkedin']);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [heroBySlide, setHeroBySlide] = useState<Record<number, { url: string; name: string }>>({});
  const [uploadingHero, setUploadingHero] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [contentId, setContentId] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const activeGenIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const topicRef = useRef<HTMLTextAreaElement | null>(null);

  const minSlides = meta?.minSlides ?? 2;
  const maxSlides = meta?.maxSlides ?? 10;
  const slideOptions = useMemo(
    () => Array.from({ length: maxSlides - minSlides + 1 }, (_, i) => minSlides + i),
    [minSlides, maxSlides],
  );
  const slideHint = useMemo(() => slideHintFor(slideCount), [slideCount]);
  const attachmentBrief = useMemo(() => {
    if (!attachments.length) return '';
    return attachments
      .map(
        (a, i) =>
          `--- Attachment ${i + 1}: ${a.fileName} (${a.kind}) ---\n${a.extractedText}`,
      )
      .join('\n\n')
      .slice(0, 16000);
  }, [attachments]);

  const heroCount = Object.keys(heroBySlide).length;
  const readyTopic = topic.trim().length >= 2;
  const activeStep = !readyTopic ? 1 : generating || contentId ? 3 : 2;

  const cancelActiveWork = async () => {
    abortRef.current?.abort();
    const genId = activeGenIdRef.current;
    activeGenIdRef.current = null;
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
    api<{ data: Meta }>('/content/carousel/meta')
      .then((r) => {
        setMeta(r.data);
        setSlideCount(r.data.defaultSlides || 3);
      })
      .catch((e) => setError(e.message));
  }, []);

  const togglePlatform = (id: string) => {
    setPlatforms((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((p) => p !== id);
      }
      return [...prev, id];
    });
  };

  const parseFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 6);
    if (!list.length) return;
    setUploading(true);
    setError('');
    setOkMsg('');
    try {
      for (const file of list) {
        if (file.size > 12 * 1024 * 1024) {
          throw new Error(`${file.name} is too large (max 12MB)`);
        }
        const fd = new FormData();
        fd.append('file', file);
        const res = await apiUpload<{
          data: {
            fileName: string;
            kind: Attachment['kind'];
            extractedText: string;
            charCount: number;
          };
        }>('/content/carousel/parse-attachment', fd);

        let previewUrl: string | undefined;
        if (res.data.kind === 'image') {
          previewUrl = URL.createObjectURL(file);
        }

        setAttachments((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fileName: res.data.fileName || file.name,
            kind: res.data.kind,
            extractedText: res.data.extractedText,
            charCount: res.data.charCount,
            previewUrl,
          },
        ]);
      }
      setOkMsg(
        list.length === 1
          ? 'Source file parsed — AI will use it for the carousel.'
          : `${list.length} source files parsed.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse attachment');
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const uploadHero = async (slideIndex: number, file: File) => {
    setUploadingHero(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiUpload<{ data: { publicUrl: string } }>(
        '/content/carousel/upload-hero',
        fd,
      );
      setHeroBySlide((prev) => ({
        ...prev,
        [slideIndex]: { url: res.data.publicUrl, name: file.name },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hero upload failed');
    } finally {
      setUploadingHero(false);
    }
  };

  const generate = async () => {
    const trimmed = topic.trim();
    if (trimmed.length < 2) {
      setError('Enter a topic for the carousel.');
      topicRef.current?.focus();
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
      const heroImageUrls = Array.from({ length: slideCount }, (_, i) => heroBySlide[i]?.url || null);
      const res = await api<{ data: { contentId: string } }>('/content/generate', {
        method: 'POST',
        body: {
          engine: 'carousel',
          topic: trimmed,
          brief: attachmentBrief || undefined,
          slideCount,
          platforms,
          heroImageUrls: heroImageUrls.some(Boolean) ? heroImageUrls : undefined,
        },
        signal: ac.signal,
      });
      const newId = res.data.contentId;
      activeGenIdRef.current = newId;
      setContentId(newId);
      setOkMsg(`Generating ${slideCount}-slide carousel… this can take a few minutes.`);

      const deadline = Date.now() + 8 * 60 * 1000;
      while (Date.now() < deadline) {
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await new Promise((r) => setTimeout(r, 2500));
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const status = await api<{
          data: { status: string; headline?: string; publishError?: string | null };
        }>(`/content/${newId}`, { signal: ac.signal });
        if (status.data.status === 'pending_approval') {
          setOkMsg('Carousel ready. Open Approvals to review each slide.');
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
      <div className="carousel-page page-container !max-w-none animate-page-enter pb-8 sm:pb-10">
        <header className="page-header">
          <div className="min-w-0 w-full">
            <BackButton href="/dashboard" label="Back to dashboard" className="mb-3" />
            <p className="panel-kicker mb-1">Multi-slide posts</p>
            <h1 className="page-title flex items-center gap-2.5">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30 sm:h-11 sm:w-11 animate-float">
                <Layers size={20} />
              </span>
              Carousel
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
              Tell the AI what to build, attach source files if you have them, set slide count — then
              review in Approvals or plan in the{' '}
              <Link
                href="/calendar"
                className="font-medium text-brand-600 underline-offset-2 hover:underline"
              >
                Content Calendar
              </Link>
              .
            </p>
          </div>
        </header>

        <WorkflowStepper
          current={activeStep}
          steps={[
            { id: 1, label: 'Brief' },
            { id: 2, label: 'Structure' },
            { id: 3, label: 'Generate' },
          ]}
        />

        <div className="carousel-stagger space-y-4 sm:space-y-5">
          {meta && (
            <div className="flex flex-wrap gap-2">
              <span className="status-badge-muted">
                Brand{' '}
                <strong className="text-[hsl(var(--foreground))]">
                  {meta.companyName || 'Set in Settings'}
                </strong>
              </span>
              <span className="status-badge-muted">Text · {meta.llmProvider}</span>
              <span className="status-badge-muted">Image · {meta.imageProvider}</span>
            </div>
          )}

          {(error || okMsg) && (
            <InlineNotice kind={error ? 'error' : 'success'}>
              {error || okMsg}
              {contentId && !error && (
                <div className="mt-2">
                  <Link
                    href={`/approvals/${contentId}`}
                    className="inline-flex items-center gap-1 font-medium text-brand-600 underline"
                  >
                    Open in Approvals <ArrowRight size={14} />
                  </Link>
                </div>
              )}
            </InlineNotice>
          )}

          {/* Brief + Sources */}
          <div className="grid gap-4 sm:gap-5 xl:grid-cols-2 xl:items-stretch">
          {/* Brief — chat composer */}
          <section className="panel scroll-mt-20 flex h-full flex-col">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Step 1 · Brief</p>
                <p className="panel-title flex items-center gap-2">
                  <MessageSquare size={15} className="text-brand-600" />
                  Tell the AI what to create
                </p>
              </div>
              {readyTopic && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 animate-scale-in">
                  <CheckCircle2 size={12} /> Ready
                </span>
              )}
            </div>
            <div className="panel-body flex-1">
              <div className="carousel-chat h-full">
                <div className="flex items-center gap-2.5 border-b border-[hsl(var(--border))] px-3 py-3 sm:px-4">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-600/30">
                    <Sparkles size={14} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Carousel assistant</p>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                      Capabilities-style slides · last slide = CTA
                    </p>
                  </div>
                </div>

                <div className="space-y-3 px-3 py-4 sm:px-4">
                  <div className="max-w-[min(100%,36rem)] rounded-2xl rounded-tl-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-sm leading-relaxed text-[hsl(var(--muted-foreground))] animate-slide-in-left">
                    What should this carousel teach or claim? I’ll turn it into a professional
                    multi-slide post — hook first, proof in the middle, CTA on the last slide.
                  </div>

                  <div className="ml-auto w-full max-w-[min(100%,36rem)] rounded-2xl rounded-tr-md bg-brand-600 px-3.5 py-3 text-white shadow-md shadow-brand-600/25 animate-scale-in">
                    <label className="sr-only" htmlFor="carousel-topic">
                      Carousel topic
                    </label>
                    <textarea
                      ref={topicRef}
                      id="carousel-topic"
                      className="w-full min-h-[88px] resize-y bg-transparent text-sm leading-relaxed text-white placeholder:text-white/60 outline-none border-0 p-0"
                      placeholder="e.g. 4 ways our API cuts onboarding time for enterprise ops teams"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      disabled={generating || uploading}
                      maxLength={300}
                      rows={3}
                    />
                    <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-white/15 pt-2">
                      <p className="text-[10px] text-white/55">{topic.trim().length}/300</p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all duration-200 ${
                          readyTopic
                            ? 'bg-white/20 text-white'
                            : 'bg-white/10 text-white/50'
                        }`}
                      >
                        {readyTopic ? (
                          <>
                            <CheckCircle2 size={11} /> Brief set
                          </>
                        ) : (
                          'Type a brief…'
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {TOPIC_HINTS.map((hint) => (
                      <button
                        key={hint}
                        type="button"
                        disabled={generating}
                        className="carousel-hint-chip"
                        onClick={() => {
                          setTopic(hint);
                          topicRef.current?.focus();
                        }}
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Sources */}
          <section className="panel scroll-mt-20 flex h-full flex-col">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Step 2 · Sources</p>
                <p className="panel-title flex items-center gap-2">
                  <Paperclip size={15} className="text-brand-600" />
                  Attach reference files
                </p>
              </div>
              {attachments.length > 0 && (
                <span className="status-badge-engine animate-scale-in">
                  {attachments.length} attached
                </span>
              )}
            </div>
            <div className="panel-body flex flex-1 flex-col space-y-4">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Optional. PDF, TXT, CSV/XLSX, or images are parsed and sent with your brief.
              </p>

              <div
                className="carousel-dropzone flex-1"
                data-active={dragOver}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files?.length) void parseFiles(e.dataTransfer.files);
                }}
              >
                <div
                  className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/10 text-brand-600 transition-transform duration-300 ${
                    dragOver ? 'scale-110' : ''
                  }`}
                >
                  <Upload size={20} />
                </div>
                <p className="mt-3 text-sm font-semibold">
                  {uploading ? 'Parsing with AI…' : 'Drop files here'}
                </p>
                <p className="helper-text mt-1">Up to 6 files · 12MB each</p>
                <label
                  className={`carousel-upload-btn mt-4 cursor-pointer ${
                    uploading ? 'pointer-events-none opacity-60' : ''
                  }`}
                >
                  <ImagePlus size={15} />
                  {uploading ? 'Uploading…' : 'Browse files'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT}
                    multiple
                    className="sr-only"
                    disabled={uploading || generating}
                    onChange={(e) => {
                      if (e.target.files?.length) void parseFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>

              {attachments.length > 0 && (
                <ul className="space-y-2 animate-fade-in">
                  {attachments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2.5 transition-all duration-200 hover:border-brand-500/35 hover:shadow-sm"
                    >
                      {a.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={a.previewUrl}
                          alt=""
                          className="h-11 w-11 rounded-lg border border-[hsl(var(--border))] object-cover"
                        />
                      ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[hsl(var(--border))] bg-brand-500/10 text-brand-600">
                          <FileText size={16} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{a.fileName}</p>
                        <p className="helper-text">
                          {a.kind} · {formatChars(a.charCount)} chars
                        </p>
                      </div>
                      <button
                        type="button"
                        className="icon-btn-danger"
                        aria-label={`Remove ${a.fileName}`}
                        disabled={generating || uploading}
                        onClick={() => removeAttachment(a.id)}
                      >
                        <X size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          </div>

          {/* Structure + Heroes */}
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-2 lg:items-stretch">
          {/* Structure */}
          <section className="panel scroll-mt-20 flex h-full flex-col">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Step 3 · Structure</p>
                <p className="panel-title">Slides &amp; platforms</p>
              </div>
            </div>
            <div className="panel-body flex flex-1 flex-col space-y-6">
              <div>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {slideCount} slides
                      <span className="ml-1.5 font-normal text-[hsl(var(--muted-foreground))]">
                        · {slideHint}
                      </span>
                    </p>
                    <p className="helper-text mt-0.5">
                      Instagram supports up to {maxSlides}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-5 gap-2 sm:flex sm:flex-wrap">
                  {slideOptions.map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={generating || uploading}
                      onClick={() => setSlideCount(n)}
                      data-active={slideCount === n}
                      aria-pressed={slideCount === n}
                      className="carousel-slide-btn w-full sm:w-auto"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold">Publish to</p>
                <div className="mt-2.5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  {PLATFORM_OPTS.map((p) => {
                    const on = platforms.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={generating || uploading}
                        onClick={() => togglePlatform(p.id)}
                        data-active={on}
                        aria-pressed={on}
                        className="carousel-platform-btn w-full justify-center sm:w-auto sm:justify-start gap-2"
                      >
                        {on && <CheckCircle2 size={14} />}
                        <PlatformBadge platform={p.id} size="sm" variant={on ? 'solid' : 'pill'} />
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-sky-500/20 bg-sky-500/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-sky-900 dark:text-sky-200 animate-fade-in">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sky-500/15 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                    i
                  </span>
                  <p>
                    Multi-image publish works on Instagram. LinkedIn, Facebook, and X receive the
                    cover slide.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Optional heroes */}
          <section className="panel scroll-mt-20 flex h-full flex-col">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Step 4 · Optional</p>
                <p className="panel-title flex items-center gap-2">
                  <ImagePlus size={15} className="text-brand-600" />
                  Exact hero photos
                </p>
              </div>
              {heroCount > 0 && (
                <span className="status-badge-muted animate-scale-in">{heroCount} pinned</span>
              )}
            </div>
            <div className="panel-body flex flex-1 flex-col space-y-3">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Pin your own photo on any slide. Layout stays; only the photo area swaps.
              </p>
              <ul className="carousel-hero-list flex-1 overflow-hidden rounded-2xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]">
                {Array.from({ length: slideCount }, (_, i) => {
                  const hero = heroBySlide[i];
                  const isLast = i === slideCount - 1;
                  return (
                    <li key={i} className="carousel-hero-row">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600/10 text-xs font-bold text-brand-700 dark:text-brand-300">
                        {i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">Slide {i + 1}</p>
                        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                          {i === 0 ? 'Hook' : isLast ? 'CTA close' : 'Proof'}
                        </p>
                      </div>
                      {hero ? (
                        <div className="flex w-full items-center gap-2 sm:w-auto">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={hero.url}
                            alt=""
                            className="h-10 w-10 rounded-lg border border-[hsl(var(--border))] object-cover"
                          />
                          <p className="min-w-0 flex-1 truncate text-xs text-[hsl(var(--muted-foreground))] sm:max-w-[8rem] sm:flex-none">
                            {hero.name}
                          </p>
                          <button
                            type="button"
                            className="icon-btn-danger ml-auto sm:ml-0"
                            aria-label={`Remove hero for slide ${i + 1}`}
                            disabled={generating || uploadingHero}
                            onClick={() =>
                              setHeroBySlide((prev) => {
                                const next = { ...prev };
                                delete next[i];
                                return next;
                              })
                            }
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <label
                          className={`carousel-upload-btn w-full justify-center min-h-[44px] md:!min-h-[40px] !px-3 cursor-pointer text-xs sm:w-auto ${
                            uploadingHero ? 'pointer-events-none opacity-60' : ''
                          }`}
                        >
                          <Upload size={13} />
                          Upload
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            disabled={generating || uploadingHero}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadHero(i, file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
          </div>

          {/* Generate */}
          <section className="panel panel-accent scroll-mt-20">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Step 5 · Generate</p>
                <p className="panel-title flex items-center gap-2">
                  <Sparkles size={15} className="text-brand-600" />
                  Create carousel
                </p>
              </div>
            </div>
            <div className="panel-body space-y-4">
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-3 text-sm text-[hsl(var(--muted-foreground))]">
                {readyTopic ? (
                  <>
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {slideCount} slides
                    </span>
                    <span className="mx-1.5">·</span>
                    <PlatformBadgeList platforms={platforms} size="sm" />
                    {attachments.length > 0 && (
                      <>
                        <span className="mx-1.5">·</span>
                        {attachments.length} source
                        {attachments.length > 1 ? 's' : ''}
                      </>
                    )}
                    {heroCount > 0 && (
                      <>
                        <span className="mx-1.5">·</span>
                        {heroCount} pinned photo{heroCount > 1 ? 's' : ''}
                      </>
                    )}
                  </>
                ) : (
                  'Add a brief above to unlock generation.'
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <ProcessingButton
                  loading={generating}
                  loadingText="Generating slides…"
                  className="carousel-gen-btn w-full sm:min-w-[16rem] sm:w-auto"
                  disabled={!readyTopic || uploading || uploadingHero}
                  onClick={() => void generate()}
                >
                  <Sparkles size={17} />
                  Generate {slideCount}-slide carousel
                  <ArrowRight size={16} className="opacity-80" />
                </ProcessingButton>
                {contentId && !generating && (
                  <Link
                    href={`/approvals/${contentId}`}
                    className="btn-secondary inline-flex w-full items-center justify-center gap-1.5 sm:w-auto hover:-translate-y-0.5"
                  >
                    Review in Approvals
                    <ArrowRight size={14} />
                  </Link>
                )}
              </div>
            </div>
          </section>
        </div>

        <ProcessOverlay
          open={generating || uploading}
          title={uploading ? 'Parsing attachments' : 'Building carousel'}
          description={
            uploading
              ? 'Extracting text and image context for the AI…'
              : `Designing ${slideCount} varied social slides + caption…`
          }
          onCancel={generating ? () => void cancelActiveWork() : undefined}
          cancelLabel="Abort"
        />
      </div>
    </AuthGuard>
  );
}

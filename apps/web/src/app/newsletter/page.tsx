'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { api, apiUpload } from '@/lib/api';
import { abortContentGeneration, isAbortError } from '@/lib/abort';
import {
  Check,
  FileText,
  Mail,
  MessageSquare,
  Pencil,
  Sparkles,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  BackButton,
  InlineNotice,
  ProcessOverlay,
  ProcessingButton,
  Toggle,
} from '@/components/ui';
import {
  CreativeModePicker,
  type CreativeVisualMode,
  CREATIVE_MODE_LABELS,
} from '@/components/creative-mode-picker';

type BrandTpl = {
  id: string;
  name: string;
  provider: string;
  backgroundUrl?: string | null;
  previewUrl?: string | null;
  dynamicLayers: Array<{
    id: string;
    type: string;
    fillType?: string | null;
    fillHint?: string | null;
    lineCount?: number | null;
  }>;
};

type DocItem = {
  id: string;
  title: string;
  category: string;
  fileType: string;
  textLength: number;
  excerpt?: string;
  lastUsedAt?: string | null;
};

type Meta = {
  newsletterMode: 'manual' | 'auto';
  templates: BrandTpl[];
  documents: DocItem[];
  llmProvider: string;
  imageProvider: string;
  hasLogo: boolean;
};

const NEWSLETTER_PREFS_KEY = 'contentpilot-newsletter-prefs';

type NewsletterPrefs = {
  instructions?: string;
  useBrand?: boolean;
  brandTemplateId?: string;
  includeLogo?: boolean;
};

function readNewsletterPrefs(): NewsletterPrefs {
  try {
    const raw = localStorage.getItem(NEWSLETTER_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as NewsletterPrefs & { generationRules?: string };
    return {
      instructions: parsed.instructions ?? parsed.generationRules,
      useBrand: parsed.useBrand,
      brandTemplateId: parsed.brandTemplateId,
      includeLogo: parsed.includeLogo,
    };
  } catch {
    return {};
  }
}

function writeNewsletterPrefs(prefs: NewsletterPrefs) {
  localStorage.setItem(NEWSLETTER_PREFS_KEY, JSON.stringify(prefs));
}

function formatChars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export default function NewsletterPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [libraryItemId, setLibraryItemId] = useState('');
  const [creativeMode, setCreativeMode] = useState<CreativeVisualMode>('ai');
  const useBrand = creativeMode === 'existing_template';
  const [brandTemplateId, setBrandTemplateId] = useState('');
  const [includeLogo, setIncludeLogo] = useState(true);
  const [slotFillStyles, setSlotFillStyles] = useState<Record<string, string>>({});
  const [instructions, setInstructions] = useState('');
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingVisual, setSavingVisual] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [contentId, setContentId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeGenIdRef = useRef<string | null>(null);
  const prefsHydrated = useRef(false);

  const loadMeta = useCallback(async () => {
    const r = await api<{ data: Meta }>('/content/newsletter/meta');
    setMeta(r.data);
    if (!libraryItemId && r.data.documents[0]) setLibraryItemId(r.data.documents[0].id);
    if (!prefsHydrated.current) {
      const prefs = readNewsletterPrefs();
      prefsHydrated.current = true;
      if (typeof prefs.instructions === 'string') setInstructions(prefs.instructions);
      if (prefs.useBrand === true) setCreativeMode('existing_template');
      else setCreativeMode('ai');
      if (prefs.brandTemplateId && r.data.templates.some((t) => t.id === prefs.brandTemplateId)) {
        setBrandTemplateId(prefs.brandTemplateId);
      } else if (r.data.templates[0]) {
        setBrandTemplateId(r.data.templates[0].id);
      }
      if (typeof prefs.includeLogo === 'boolean') setIncludeLogo(prefs.includeLogo);
    } else if (!brandTemplateId && r.data.templates[0]) {
      setBrandTemplateId(r.data.templates[0].id);
    }
    return r.data;
  }, [brandTemplateId, libraryItemId]);

  useEffect(() => {
    loadMeta().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedBrand = meta?.templates.find((t) => t.id === brandTemplateId) || null;
  const isPlacid = selectedBrand?.provider === 'placid';
  const selectedDoc = meta?.documents.find((d) => d.id === libraryItemId) || null;

  const persistPrefs = (patch?: Partial<NewsletterPrefs>) => {
    writeNewsletterPrefs({
      instructions,
      useBrand,
      brandTemplateId,
      includeLogo,
      ...patch,
    });
  };

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
      } catch {
        setOkMsg('Stopped waiting. Open Approvals if a draft was created.');
      }
    } else {
      setOkMsg('Cancelled.');
    }
  };

  const saveVisualPrefs = async () => {
    setSavingVisual(true);
    setError('');
    try {
      persistPrefs();
      setOkMsg('Visual preferences saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingVisual(false);
    }
  };

  const startRename = (doc: DocItem) => {
    setRenamingId(doc.id);
    setRenameDraft(doc.title);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft('');
  };

  const saveRename = async () => {
    if (!renamingId) return;
    const title = renameDraft.trim();
    if (title.length < 1) {
      setError('Enter a document name.');
      return;
    }
    setSavingRename(true);
    setError('');
    try {
      await api(`/settings/library/${renamingId}`, {
        method: 'PATCH',
        body: { title },
      });
      setOkMsg(`Renamed to “${title}”.`);
      setRenamingId(null);
      setRenameDraft('');
      await loadMeta();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed');
    } finally {
      setSavingRename(false);
    }
  };

  const uploadDoc = async (file: File) => {
    setUploading(true);
    setError('');
    setOkMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', file.name.replace(/\.[^.]+$/, '') || file.name);
      fd.append('category', 'product');
      const res = await apiUpload<{ data: { id: string; title: string } }>(
        '/settings/library/upload',
        fd,
      );
      setOkMsg(`“${res.data.title}” uploaded. Rename it if you like.`);
      const m = await loadMeta();
      setLibraryItemId(res.data.id);
      if (m) setMeta(m);
      setRenamingId(res.data.id);
      setRenameDraft(res.data.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const pollUntilReady = async (newId: string, ac: AbortController) => {
    activeGenIdRef.current = newId;
    setContentId(newId);
    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline) {
      if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      await new Promise((r) => setTimeout(r, 2500));
      if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const status = await api<{
        data: { status: string; publishError?: string | null };
      }>(`/content/${newId}`, { signal: ac.signal });
      if (status.data.status === 'pending_approval') {
        setOkMsg('Edition ready. Review copy and creative in Approvals.');
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
  };

  const generate = async (auto = false) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    activeGenIdRef.current = null;
    setGenerating(true);
    setError('');
    setOkMsg(auto ? 'Rotating documents for this edition…' : 'Drafting your newsletter…');
    persistPrefs();
    try {
      if (!auto && !libraryItemId && !(meta?.documents.length)) {
        throw new Error('Upload a product brief or tech document first.');
      }
      const res = await api<{ data: { contentId: string } }>('/content/generate', {
        method: 'POST',
        body: {
          engine: 'newsletter',
          libraryItemId: auto ? null : libraryItemId || null,
          newsletterTemplateId: null,
          freeform: !auto,
          useBrandTemplate: useBrand && Boolean(brandTemplateId),
          brandTemplateId: useBrand ? brandTemplateId : null,
          visualMode: creativeMode,
          generationRules: instructions.trim() || undefined,
          includeLogo: !useBrand && includeLogo,
          slotFillStyles: useBrand ? slotFillStyles : undefined,
        },
        signal: ac.signal,
      });
      await pollUntilReady(res.data.contentId, ac);
    } catch (e) {
      if (isAbortError(e)) setOkMsg('Generation aborted.');
      else setError(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      activeGenIdRef.current = null;
      setGenerating(false);
    }
  };

  const canGenerate = Boolean(libraryItemId) || (meta?.documents.length || 0) === 0;

  const promptHints = useMemo(
    () => [
      'Lead with the enterprise security angle; soft CTA to book a demo',
      '3 short sections for ops leaders; no pricing; end with a webinar invite',
      'Focus only on the new API release notes in this PDF',
    ],
    [],
  );

  return (
    <AuthGuard>
      <div className="mx-auto max-w-3xl space-y-5 sm:space-y-6 animate-fade-in pb-28">
        <div className="page-header">
          <div>
            <BackButton href="/dashboard" label="Back to dashboard" className="mb-3" />
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Mail className="text-brand-600" size={22} />
              Product Newsletter
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              Upload a product PDF, tell the AI exactly what to do, pick a visual — then review in
              Approvals.
            </p>
          </div>
        </div>

        {meta && (
          <div className="card !p-4 text-xs text-[hsl(var(--muted-foreground))] flex flex-wrap gap-x-4 gap-y-1 animate-slide-down">
            <span>
              Mode:{' '}
              <strong className="text-[hsl(var(--foreground))]">{meta.newsletterMode}</strong>
            </span>
            <span>{meta.documents.length} docs</span>
            <span>Text: {meta.llmProvider}</span>
            <span>Image: {meta.imageProvider}</span>
          </div>
        )}

        {(error || okMsg) && (
          <InlineNotice kind={error ? 'error' : 'success'}>
            {error || okMsg}
            {contentId && !error && (
              <div className="mt-2">
                <Link href={`/approvals/${contentId}`} className="font-medium text-brand-600 underline">
                  Open in Approvals
                </Link>
              </div>
            )}
          </InlineNotice>
        )}

        {meta?.newsletterMode === 'auto' && (
          <section className="card space-y-4 workflow-stage">
            <div>
              <p className="panel-kicker">Automation</p>
              <p className="mt-1 text-sm font-medium flex items-center gap-2">
                <Zap size={15} className="text-brand-600" /> Auto edition
              </p>
              <p className="helper-text mt-1">
                Rotates product documents on a schedule. Visual settings below still apply.
              </p>
            </div>
            <ProcessingButton
              loading={generating}
              loadingText="Running edition…"
              className="inline-flex items-center gap-1.5"
              onClick={() => void generate(true)}
            >
              <Zap size={16} />
              Run auto newsletter
            </ProcessingButton>
          </section>
        )}

        <section className="card space-y-4 workflow-stage">
          <div>
            <p className="panel-kicker">Step 1 · Source</p>
            <p className="mt-1 text-sm font-medium flex items-center gap-2">
              <FileText size={15} className="text-brand-600" /> Product document
            </p>
            <p className="helper-text mt-1">
              Copy stays grounded in this file. Upload a PDF or text brief, then rename if needed.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.doc,.docx,application/pdf,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadDoc(f);
              }}
            />
            <ProcessingButton
              variant="secondary"
              loading={uploading}
              loadingText="Uploading…"
              className="inline-flex items-center gap-1.5"
              onClick={() => fileRef.current?.click()}
              disabled={generating}
            >
              <Upload size={14} />
              Upload document
            </ProcessingButton>
          </div>

          {meta && meta.documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.25)] px-4 py-8 text-center">
              <FileText className="mx-auto mb-2 text-[hsl(var(--muted-foreground))]" size={28} />
              <p className="text-sm font-medium">No source documents yet</p>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                Upload a product one-pager, release notes, or solution brief.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {(meta?.documents || []).map((d) => {
                const active = libraryItemId === d.id;
                const editing = renamingId === d.id;
                return (
                  <li
                    key={d.id}
                    className={`rounded-xl border transition-all duration-200 ${
                      active
                        ? 'border-brand-600 bg-brand-600/[0.06] ring-1 ring-brand-600/20'
                        : 'border-[hsl(var(--border))] hover:border-brand-500/35'
                    }`}
                  >
                    {editing ? (
                      <div className="flex flex-wrap items-center gap-2 p-3">
                        <input
                          className="input min-w-0 flex-1"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          autoFocus
                          maxLength={200}
                          disabled={savingRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveRename();
                            if (e.key === 'Escape') cancelRename();
                          }}
                        />
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="Save name"
                          disabled={savingRename}
                          onClick={() => void saveRename()}
                        >
                          <Check size={16} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="Cancel rename"
                          disabled={savingRename}
                          onClick={cancelRename}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 p-3">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setLibraryItemId(d.id)}
                          disabled={generating || uploading}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium leading-snug line-clamp-2">{d.title}</p>
                            {active && (
                              <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                Selected
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                            {(d.category || 'product').replace(/_/g, ' ')} ·{' '}
                            {formatChars(d.textLength)} chars · {d.fileType || 'doc'}
                          </p>
                          {d.excerpt && (
                            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                              {d.excerpt}
                            </p>
                          )}
                        </button>
                        <button
                          type="button"
                          className="icon-btn shrink-0"
                          aria-label={`Rename ${d.title}`}
                          disabled={generating || uploading}
                          onClick={() => startRename(d)}
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card space-y-4 workflow-stage">
          <div>
            <p className="panel-kicker">Step 2 · Instructions</p>
            <p className="mt-1 text-sm font-medium flex items-center gap-2">
              <MessageSquare size={15} className="text-brand-600" /> Tell the AI what to do
            </p>
            <p className="helper-text mt-1">
              Chat-style prompt — followed exactly for structure, tone, CTA, and focus.
            </p>
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)] overflow-hidden">
            <div className="border-b border-[hsl(var(--border))] px-3.5 py-2.5 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600/10 text-brand-600">
                <Sparkles size={14} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold">Newsletter assistant</p>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  {selectedDoc ? `Using “${selectedDoc.title}”` : 'Select a document first'}
                </p>
              </div>
            </div>

            <div className="space-y-3 px-3.5 py-3.5">
              <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-[hsl(var(--card))] border border-[hsl(var(--border))] px-3.5 py-2.5 text-sm text-[hsl(var(--muted-foreground))]">
                What should I do with this product newsletter? Audience, pillars, do/don’t, CTA,
                length — I’ll follow your instructions exactly and only use facts from the source
                document.
              </div>

              <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-md bg-brand-600 text-white px-3.5 py-2.5 shadow-sm shadow-brand-600/20">
                <label className="sr-only" htmlFor="nl-instructions">
                  Your instructions
                </label>
                <textarea
                  id="nl-instructions"
                  className="w-full min-h-[110px] resize-y bg-transparent text-sm text-white placeholder:text-white/65 outline-none border-0 p-0"
                  placeholder="e.g. Lead with the new API for ops leaders in MENA. Three short sections. Soft CTA: Book a demo. Never invent pricing."
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  disabled={generating}
                  maxLength={8000}
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {promptHints.map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    disabled={generating}
                    className="chip min-h-[44px] md:!min-h-[28px] !text-[10px]"
                    onClick={() => setInstructions(hint)}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="card space-y-4 workflow-stage">
          <div>
            <p className="panel-kicker">Step 3 · Visual</p>
            <p className="mt-1 text-sm font-medium flex items-center gap-2">
              <Sparkles size={15} className="text-brand-600" /> Creative layout
            </p>
          </div>

          <CreativeModePicker
            value={creativeMode}
            onChange={setCreativeMode}
            brandTemplatesCount={meta?.templates.length || 0}
          />

          {useBrand ? (
            <div className="animate-scale-in space-y-3">
              <select
                className="input"
                value={brandTemplateId}
                onChange={(e) => setBrandTemplateId(e.target.value)}
                disabled={generating}
              >
                {(meta?.templates || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.provider === 'placid' ? 'Imported' : 'In-house'})
                  </option>
                ))}
              </select>
              {selectedBrand && (
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-3 text-xs space-y-1.5">
                  <p className="font-medium">
                    Dynamic layers ({selectedBrand.dynamicLayers.length})
                    {isPlacid ? ' — Imported' : ''}
                  </p>
                  {selectedBrand.dynamicLayers.length === 0 ? (
                    <p className="text-[hsl(var(--muted-foreground))]">
                      No dynamic layers listed. Mark layers dynamic in Brand Studio.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                        Fixed layers stay exactly as designed. Choose how each dynamic text zone is written.
                      </p>
                      {selectedBrand.dynamicLayers
                        .filter((l) => l.type !== 'image')
                        .map((l) => (
                          <label key={l.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_11.5rem] sm:items-center sm:gap-3">
                            <span className="min-w-0 text-[hsl(var(--foreground))]">
                              <span className="font-medium">{l.id}</span>
                              {l.fillType ? (
                                <span className="text-[hsl(var(--muted-foreground))]"> · {l.fillType}</span>
                              ) : null}
                              {l.lineCount ? (
                                <span className="text-[hsl(var(--muted-foreground))]"> · {l.lineCount} lines</span>
                              ) : null}
                              {l.fillHint ? (
                                <span className="mt-0.5 block text-[10px] text-[hsl(var(--muted-foreground))]">
                                  {l.fillHint}
                                </span>
                              ) : null}
                            </span>
                            <select
                              className="input min-h-[40px] text-xs"
                              value={slotFillStyles[l.id] || 'professional'}
                              disabled={generating}
                              onChange={(e) =>
                                setSlotFillStyles((prev) => ({ ...prev, [l.id]: e.target.value }))
                              }
                            >
                              <option value="professional">Professional (fit the box)</option>
                              <option value="headline">One strong headline</option>
                              <option value="bullets">Bullet lines (full phrases)</option>
                              <option value="paragraph">Short paragraph</option>
                              <option value="keep">Keep original text</option>
                            </select>
                          </label>
                        ))}
                    </div>
                  )}
                  <Link
                    href="/brand-studio/placid"
                    className="inline-flex font-medium text-brand-600 underline"
                  >
                    Edit imported layer rules
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="animate-scale-in">
              <Toggle
                checked={includeLogo}
                onCheckedChange={setIncludeLogo}
                label="Stamp company logo on the creative"
                description={
                  meta?.hasLogo
                    ? 'Uses logo from Settings → Company.'
                    : 'Upload a logo in Settings → Company first.'
                }
                disabled={!meta?.hasLogo || generating}
              />
            </div>
          )}

          <ProcessingButton
            variant="secondary"
            className="min-h-[44px] md:!min-h-[36px] text-xs"
            loading={savingVisual}
            loadingText="Saving…"
            onClick={() => void saveVisualPrefs()}
          >
            Save visual prefs
          </ProcessingButton>
        </section>

        <section className="card space-y-3 workflow-stage">
          <div>
            <p className="panel-kicker">Step 4 · Generate</p>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              {selectedDoc
                ? `Source: ${selectedDoc.title}. Visual: ${
                    useBrand
                      ? selectedBrand?.name || CREATIVE_MODE_LABELS.existing_template
                      : creativeMode === 'ai_baked_layout'
                        ? CREATIVE_MODE_LABELS.ai_baked_layout
                        : CREATIVE_MODE_LABELS.ai
                  }${!useBrand && includeLogo ? ' + logo' : ''}.`
                : 'Select a source document above to unlock generation.'}
            </p>
          </div>
          <ProcessingButton
            loading={generating}
            loadingText="Drafting edition…"
            className="inline-flex w-full items-center justify-center gap-1.5 min-h-[48px] sm:w-auto"
            disabled={!canGenerate && (meta?.documents.length || 0) > 0}
            onClick={() => void generate(false)}
          >
            <Sparkles size={16} />
            Generate newsletter
          </ProcessingButton>
        </section>
      </div>

      <ProcessOverlay
        open={generating || uploading}
        title={uploading ? 'Ingesting document' : 'Drafting newsletter edition'}
        description={
          uploading
            ? 'Extracting text so copy stays source-grounded…'
            : 'Writing caption and preparing the visual…'
        }
        onCancel={generating ? () => void cancelActiveWork() : undefined}
        cancelLabel="Abort"
      />
    </AuthGuard>
  );
}

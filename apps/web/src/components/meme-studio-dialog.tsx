'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ExternalLink,
  FileText,
  Globe,
  LayoutTemplate,
  Paintbrush,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { ProcessingButton } from '@/components/ui';
import type { CreativeVisualMode } from '@/components/creative-mode-picker';

export type MemeCreativeChoice = 'inhouse' | 'placid' | 'ai' | 'ai_painter';

export type MemeStudioChoices = {
  contentSource: 'product' | 'brand' | 'both';
  libraryItemId: string | null;
  creativeChoice: MemeCreativeChoice;
  visualMode: CreativeVisualMode;
  brandTemplateId: string | null;
  preferredFormatId: string;
};

type Doc = { id: string; title: string };
type Tpl = { id: string; name: string; provider?: string | null };
type Fmt = { id: string; label: string; heat: number };

type Props = {
  open: boolean;
  title: string;
  imageUrl: string;
  sourceLabel: string;
  sourceHref: string;
  snippet: string;
  suggestedFormatId?: string;
  documents: Doc[];
  templates: Tpl[];
  formats: Fmt[];
  hasBrandContext: boolean;
  websiteUrl: string;
  busy: boolean;
  onClose: () => void;
  onGenerate: (choices: MemeStudioChoices) => void;
};

/** Backend value each on-screen creative option maps to. */
const VISUAL_MODE: Record<MemeCreativeChoice, CreativeVisualMode> = {
  inhouse: 'existing_template',
  placid: 'existing_template',
  ai: 'ai',
  ai_painter: 'ai_baked_layout',
};

const CREATIVE_OPTIONS: Array<{
  id: MemeCreativeChoice;
  label: string;
  hint: string;
  icon: typeof LayoutTemplate;
}> = [
  {
    id: 'inhouse',
    label: 'In-house',
    hint: 'Your own uploaded Brand Studio template, filled with the meme copy.',
    icon: LayoutTemplate,
  },
  {
    id: 'placid',
    label: 'Placid',
    hint: 'A Placid-rendered brand template — pixel-consistent every run.',
    icon: LayoutTemplate,
  },
  {
    id: 'ai',
    label: 'AI LLM',
    hint: 'AI art matched to the meme, captions drawn as a crisp overlay frame.',
    icon: Sparkles,
  },
  {
    id: 'ai_painter',
    label: 'Only AI painter',
    hint: 'One painted image with the text baked in — closest to a real meme.',
    icon: Paintbrush,
  },
];

const STEPS = ['Content', 'Creative', 'Format'] as const;

export function MemeStudioDialog(props: Props) {
  const {
    open,
    title,
    imageUrl,
    sourceLabel,
    sourceHref,
    snippet,
    suggestedFormatId,
    documents,
    templates,
    formats,
    hasBrandContext,
    websiteUrl,
    busy,
    onClose,
    onGenerate,
  } = props;

  const [step, setStep] = useState(0);
  const [contentSource, setContentSource] = useState<'product' | 'brand' | 'both'>('product');
  const [libraryItemId, setLibraryItemId] = useState('');
  const [creativeChoice, setCreativeChoice] = useState<MemeCreativeChoice>('ai');
  const [brandTemplateId, setBrandTemplateId] = useState('');
  const [preferredFormatId, setPreferredFormatId] = useState('');

  const inhouseTemplates = useMemo(
    () => templates.filter((t) => (t.provider || 'inhouse') === 'inhouse'),
    [templates],
  );
  const placidTemplates = useMemo(
    () => templates.filter((t) => t.provider === 'placid'),
    [templates],
  );
  const templatesFor = (choice: MemeCreativeChoice) =>
    choice === 'inhouse' ? inhouseTemplates : choice === 'placid' ? placidTemplates : [];

  // Reset to a sane starting point each time a meme is opened.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setContentSource(documents.length ? 'product' : 'brand');
    setLibraryItemId(documents[0]?.id || '');
    setCreativeChoice('ai');
    setBrandTemplateId('');
    setPreferredFormatId('');
  }, [open, documents]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  const pickCreative = (choice: MemeCreativeChoice) => {
    setCreativeChoice(choice);
    setBrandTemplateId(templatesFor(choice)[0]?.id || '');
  };

  const needsDoc = contentSource !== 'brand';
  const needsTemplate = creativeChoice === 'inhouse' || creativeChoice === 'placid';

  const stepError = (): string => {
    if (step === 0) {
      if (needsDoc && !libraryItemId) return 'Pick the product document this meme is about.';
      if (contentSource !== 'product' && !hasBrandContext)
        return 'No website content saved yet — scrape your site in Settings → Company, or use a product document.';
      return '';
    }
    if (step === 1) {
      if (needsTemplate && !brandTemplateId)
        return creativeChoice === 'placid'
          ? 'No Placid templates yet. Add one in Brand Studio or pick an AI option.'
          : 'No in-house templates yet. Upload one in Brand Studio or pick an AI option.';
      return '';
    }
    return '';
  };
  const blocker = stepError();

  const submit = () => {
    onGenerate({
      contentSource,
      libraryItemId: needsDoc ? libraryItemId || null : null,
      creativeChoice,
      visualMode: VISUAL_MODE[creativeChoice],
      brandTemplateId: needsTemplate ? brandTemplateId || null : null,
      preferredFormatId,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create meme from this design"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            <p className="text-[11px] text-brand-600">
              {sourceLabel}
              {suggestedFormatId ? ` · ${suggestedFormatId}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2 overflow-y-auto border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-4 md:border-b-0 md:border-r">
            <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-black/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={title}
                referrerPolicy="no-referrer"
                className="max-h-[42vh] w-full object-contain"
              />
            </div>
            {snippet ? (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{snippet}</p>
            ) : null}
            {sourceHref ? (
              <a
                href={sourceHref}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-[11px] text-brand-600"
              >
                Open source <ExternalLink size={10} />
              </a>
            ) : null}
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              We reproduce this layout, panel split and caption rhythm with original art — never a
              copy of the image.
            </p>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-4 py-2.5 text-[11px]">
              {STEPS.map((label, i) => (
                <div key={label} className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${
                      i === step
                        ? 'bg-brand-500/15 font-medium text-brand-700 dark:text-brand-300'
                        : i < step
                          ? 'text-emerald-600'
                          : 'text-[hsl(var(--muted-foreground))]'
                    }`}
                  >
                    {i < step ? <Check size={11} /> : <span>{i + 1}.</span>}
                    {label}
                  </span>
                  {i < STEPS.length - 1 ? (
                    <span className="text-[hsl(var(--muted-foreground))]">→</span>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {step === 0 && (
                <>
                  <div>
                    <h3 className="text-sm font-semibold">What should this meme be about?</h3>
                    <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                      The joke copies the meme&apos;s format, but every fact comes from the source
                      you pick here.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {(
                      [
                        {
                          id: 'product' as const,
                          icon: FileText,
                          label: 'A product document',
                          hint: 'Uploaded on the Newsletter page.',
                          disabled: !documents.length,
                          disabledHint: 'Upload a product document on the Newsletter page first.',
                        },
                        {
                          id: 'brand' as const,
                          icon: Globe,
                          label: 'Website content from brand settings',
                          hint: websiteUrl
                            ? `Scraped from ${websiteUrl}`
                            : 'Voice, audience and guidelines saved in Settings → Company.',
                          disabled: !hasBrandContext,
                          disabledHint:
                            'Scrape your website in Settings → Company to use this source.',
                        },
                        {
                          id: 'both' as const,
                          icon: Sparkles,
                          label: 'Both',
                          hint: 'Product facts, framed in your website voice.',
                          disabled: !documents.length || !hasBrandContext,
                          disabledHint: 'Needs both a product document and scraped website content.',
                        },
                      ] as const
                    ).map((opt) => {
                      const Icon = opt.icon;
                      const active = contentSource === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={opt.disabled}
                          onClick={() => setContentSource(opt.id)}
                          className={`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition ${
                            active
                              ? 'border-brand-500 bg-brand-500/5 ring-1 ring-brand-500/30'
                              : 'border-[hsl(var(--border))] hover:border-brand-500/40'
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <Icon size={16} className="mt-0.5 shrink-0 text-brand-600" />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{opt.label}</span>
                            <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                              {opt.disabled ? opt.disabledHint : opt.hint}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {needsDoc && documents.length > 0 && (
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium">Product document</span>
                      <select
                        className="input"
                        value={libraryItemId}
                        onChange={(e) => setLibraryItemId(e.target.value)}
                      >
                        <option value="">Select a product document…</option>
                        {documents.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}

              {step === 1 && (
                <>
                  <div>
                    <h3 className="text-sm font-semibold">How should it be rendered?</h3>
                    <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                      All four options are locked to the selected meme&apos;s structure — they only
                      differ in how the artwork is produced.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CREATIVE_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const active = creativeChoice === opt.id;
                      const count = templatesFor(opt.id).length;
                      const unavailable =
                        (opt.id === 'inhouse' || opt.id === 'placid') && count === 0;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => pickCreative(opt.id)}
                          disabled={unavailable}
                          className={`rounded-xl border p-3 text-left transition ${
                            active
                              ? 'border-brand-500 bg-brand-500/5 ring-1 ring-brand-500/30'
                              : 'border-[hsl(var(--border))] hover:border-brand-500/40'
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            <Icon size={14} className="text-brand-600" />
                            {opt.label}
                          </span>
                          <span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]">
                            {unavailable ? 'No templates of this type yet.' : opt.hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {needsTemplate && templatesFor(creativeChoice).length > 0 && (
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium">
                        {creativeChoice === 'placid' ? 'Placid template' : 'In-house template'}
                      </span>
                      <select
                        className="input"
                        value={brandTemplateId}
                        onChange={(e) => setBrandTemplateId(e.target.value)}
                      >
                        {templatesFor(creativeChoice).map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}

              {step === 2 && (
                <>
                  <div>
                    <h3 className="text-sm font-semibold">Confirm the meme format</h3>
                    <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                      Auto reads the structure straight off the meme you picked. Override only if
                      you want a different archetype.
                    </p>
                  </div>
                  {formats.length > 0 && (
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium">Format</span>
                      <select
                        className="input"
                        value={preferredFormatId}
                        onChange={(e) => setPreferredFormatId(e.target.value)}
                      >
                        <option value="">
                          Auto — from the selected meme
                          {suggestedFormatId ? ` (${suggestedFormatId})` : ''}
                        </option>
                        {formats.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label} (heat {f.heat})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <dl className="space-y-1.5 rounded-xl border border-[hsl(var(--border))] p-3 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-[hsl(var(--muted-foreground))]">Content</dt>
                      <dd className="text-right font-medium">
                        {contentSource === 'brand'
                          ? 'Website content'
                          : documents.find((d) => d.id === libraryItemId)?.title || 'Product document'}
                        {contentSource === 'both' ? ' + website' : ''}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-[hsl(var(--muted-foreground))]">Creative</dt>
                      <dd className="text-right font-medium">
                        {CREATIVE_OPTIONS.find((o) => o.id === creativeChoice)?.label}
                        {needsTemplate
                          ? ` · ${templates.find((t) => t.id === brandTemplateId)?.name || ''}`
                          : ''}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-[hsl(var(--muted-foreground))]">Reference</dt>
                      <dd className="text-right font-medium">Selected meme layout (locked)</dd>
                    </div>
                  </dl>
                </>
              )}

              {blocker ? (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  {blocker}
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[hsl(var(--border))] px-4 py-3">
              <button
                type="button"
                className="btn-ghost text-sm"
                disabled={busy}
                onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}
              >
                {step === 0 ? 'Cancel' : 'Back'}
              </button>
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={Boolean(blocker)}
                  onClick={() => setStep((s) => s + 1)}
                >
                  Next
                </button>
              ) : (
                <ProcessingButton
                  loading={busy}
                  loadingText="Generating…"
                  disabled={Boolean(blocker)}
                  onClick={submit}
                  icon={<Zap size={16} />}
                >
                  Create on-brand meme
                </ProcessingButton>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

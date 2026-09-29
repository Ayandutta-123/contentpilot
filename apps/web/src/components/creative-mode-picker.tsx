'use client';

import { LayoutTemplate, Sparkles, Type } from 'lucide-react';

export type CreativeVisualMode = 'existing_template' | 'ai' | 'ai_baked_layout';

/** Short titles shown on the picker buttons (and anywhere we name a mode). */
export const CREATIVE_MODE_LABELS: Record<CreativeVisualMode, string> = {
  existing_template: 'Brand template',
  ai: 'AI photo + LLM layout',
  ai_baked_layout: 'AI painted poster',
};

/** One-line subtitles under each picker button. */
export const CREATIVE_MODE_HINTS: Record<CreativeVisualMode, string> = {
  existing_template: 'Fixed Brand Studio / Placid plate',
  ai: 'LLM designs poster; AI paints photo; real logo',
  ai_baked_layout: 'AI paints scene + text; we stamp your real logo',
};

/** Longer helper blurbs used under the picker on engine pages. */
export const CREATIVE_MODE_BLURBS: Record<CreativeVisualMode, string> = {
  existing_template:
    'Fills your Brand Studio / Placid plate — fixed slots for logo, headline, and images.',
  ai: 'LLM designs the poster layout and copy; AI generates the photo; your real logo is overlaid.',
  ai_baked_layout:
    'AI paints the finished poster (scene + lettering); your real brand logo is stamped afterward.',
};

type Props = {
  value: CreativeVisualMode | null;
  onChange: (mode: CreativeVisualMode) => void;
  brandTemplatesCount?: number;
  /** denser grid on wide modals */
  columns?: 2 | 3;
  className?: string;
};

/**
 * Shared creative picker: Brand template / AI photo + LLM layout / AI painted poster.
 */
export function CreativeModePicker({
  value,
  onChange,
  brandTemplatesCount = 0,
  columns = 3,
  className = '',
}: Props) {
  const grid =
    columns === 2
      ? 'grid grid-cols-1 gap-2 sm:grid-cols-2'
      : 'grid grid-cols-1 gap-2 xs:grid-cols-1 sm:grid-cols-3';

  return (
    <div className={`space-y-2 ${className}`}>
      <p className="field-label">Creative</p>
      <div className={grid}>
        <button
          type="button"
          className={`cal-choice ${value === 'existing_template' ? 'cal-choice-on' : 'cal-choice-off'}`}
          onClick={() => onChange('existing_template')}
          disabled={!brandTemplatesCount}
        >
          <LayoutTemplate size={14} className="mb-1 text-brand-600" />
          <span className="block text-sm font-semibold">
            {CREATIVE_MODE_LABELS.existing_template}
          </span>
          <span className="mt-1 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">
            {brandTemplatesCount
              ? CREATIVE_MODE_HINTS.existing_template
              : 'Create a template in Brand Studio first'}
          </span>
        </button>
        <button
          type="button"
          className={`cal-choice ${value === 'ai' ? 'cal-choice-on' : 'cal-choice-off'}`}
          onClick={() => onChange('ai')}
        >
          <Sparkles size={14} className="mb-1 text-brand-600" />
          <span className="block text-sm font-semibold">{CREATIVE_MODE_LABELS.ai}</span>
          <span className="mt-1 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">
            {CREATIVE_MODE_HINTS.ai}
          </span>
        </button>
        <button
          type="button"
          className={`cal-choice ${value === 'ai_baked_layout' ? 'cal-choice-on' : 'cal-choice-off'}`}
          onClick={() => onChange('ai_baked_layout')}
        >
          <Type size={14} className="mb-1 text-brand-600" />
          <span className="block text-sm font-semibold">
            {CREATIVE_MODE_LABELS.ai_baked_layout}
          </span>
          <span className="mt-1 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">
            {CREATIVE_MODE_HINTS.ai_baked_layout}
          </span>
        </button>
      </div>
      {!value ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Choose a creative style before generating.
        </p>
      ) : null}
    </div>
  );
}

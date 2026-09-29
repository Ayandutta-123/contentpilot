'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  Download,
  Sparkles,
  X,
  ChevronRight,
  MessageSquare,
  Save,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ProcessingButton, Spinner } from '@/components/ui';
import { notifyError, notifySuccess } from '@/lib/toast';

export type AiWizardEntry = {
  id: string;
  date: string;
  title: string;
  theme: string;
  notes: string;
  hashtags: string[];
  carouselSlideCount?: number | null;
};

type Step = 'intent' | 'cadence' | 'building' | 'preview' | 'revise' | 'confirm';

const CONTENT_TYPES: { id: string; label: string; hint: string }[] = [
  { id: 'thought_leadership', label: 'Thought leadership', hint: 'POV & market takes' },
  { id: 'carousel', label: 'Educational carousel', hint: 'Slide stories' },
  { id: 'offer', label: 'Offer / CTA', hint: 'Campaigns & asks' },
  { id: 'product', label: 'Product highlight', hint: 'Features & demos' },
  { id: 'culture', label: 'Culture', hint: 'Behind the scenes' },
  { id: 'festival', label: 'Seasonal / festival', hint: 'Calendar moments' },
  { id: 'competitor_response', label: 'Market-informed', hint: 'From competitor watch' },
  { id: 'newsletter_teaser', label: 'Long-form teaser', hint: 'Newsletter hooks' },
];

const WEEKDAYS = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 0, label: 'Sun' },
];

const STEPS: Step[] = ['intent', 'cadence', 'building', 'preview', 'revise', 'confirm'];

function stepIndex(s: Step) {
  return STEPS.indexOf(s);
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

async function downloadEntriesExcel(entries: AiWizardEntry[]) {
  const res = await fetch('/api/content/calendar/plan/export.xlsx', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entries: entries.map((e) => ({
        date: e.date,
        title: e.title,
        theme: e.theme,
        notes: e.notes,
        hashtags: e.hashtags,
        carouselSlideCount: e.carouselSlideCount ?? null,
      })),
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `content-calendar-${entries[0]?.date?.slice(0, 7) || 'plan'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CalendarAiWizard({
  open,
  year,
  month,
  timezones,
  defaultTimezone,
  defaultRunTime,
  onClose,
  onComplete,
}: {
  open: boolean;
  year: number;
  month: number;
  timezones: string[];
  defaultTimezone: string;
  defaultRunTime: string;
  onClose: () => void;
  onComplete: (payload: {
    entries: AiWizardEntry[];
    name: string;
    runTime: string;
    timezone: string;
    executionMode: 'automatic' | 'manual';
  }) => void;
}) {
  const [step, setStep] = useState<Step>('intent');
  const [suggestions, setSuggestions] = useState('');
  const [contentTypes, setContentTypes] = useState<string[]>([
    'thought_leadership',
    'carousel',
    'product',
  ]);
  const [postsPerMonth, setPostsPerMonth] = useState(12);
  const [carouselCount, setCarouselCount] = useState(3);
  const [carouselSlides, setCarouselSlides] = useState(6);
  const [preferredWeekdays, setPreferredWeekdays] = useState<number[]>([1, 2, 3, 4]);
  const [entries, setEntries] = useState<AiWizardEntry[]>([]);
  const [summary, setSummary] = useState('');
  const [reviseText, setReviseText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [planName, setPlanName] = useState('');
  const [runTime, setRunTime] = useState(defaultRunTime || '10:00');
  const [timezone, setTimezone] = useState(defaultTimezone || 'Asia/Kolkata');
  const [executionMode, setExecutionMode] = useState<'automatic' | 'manual'>('automatic');

  useEffect(() => {
    if (!open) return;
    setStep('intent');
    setSuggestions('');
    setContentTypes(['thought_leadership', 'carousel', 'product']);
    setPostsPerMonth(12);
    setCarouselCount(3);
    setCarouselSlides(6);
    setPreferredWeekdays([1, 2, 3, 4]);
    setEntries([]);
    setSummary('');
    setReviseText('');
    setBusy(false);
    setError('');
    setPlanName(`AI plan · ${monthLabel(year, month)}`);
    setRunTime(defaultRunTime || '10:00');
    setTimezone(defaultTimezone || 'Asia/Kolkata');
    setExecutionMode('automatic');
  }, [open, year, month, defaultRunTime, defaultTimezone]);

  const label = monthLabel(year, month);
  const progress = ((stepIndex(step) + 1) / STEPS.length) * 100;

  const toggleType = (id: string) => {
    setContentTypes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleDay = (id: number) => {
    setPreferredWeekdays((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const buildPlan = async () => {
    setStep('building');
    setBusy(true);
    setError('');
    try {
      const res = await api<{
        data: { entries: AiWizardEntry[]; summary: string };
      }>('/content/calendar/plan/ai/generate', {
        method: 'POST',
        body: {
          year,
          month,
          suggestions,
          contentTypes,
          postsPerMonth,
          carouselCount: Math.min(carouselCount, postsPerMonth),
          carouselSlides,
          preferredWeekdays,
        },
      });
      setEntries(res.data.entries);
      setSummary(res.data.summary);
      setStep('preview');
      notifySuccess(`Draft ready · ${res.data.entries.length} ideas`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not build calendar';
      setError(msg);
      notifyError(msg);
      setStep('cadence');
    } finally {
      setBusy(false);
    }
  };

  const applyRevise = async () => {
    if (!reviseText.trim()) {
      setStep('confirm');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api<{
        data: { entries: AiWizardEntry[]; summary: string };
      }>('/content/calendar/plan/ai/revise', {
        method: 'POST',
        body: {
          year,
          month,
          instruction: reviseText.trim(),
          entries,
        },
      });
      setEntries(res.data.entries);
      setSummary(res.data.summary);
      setReviseText('');
      setStep('preview');
      notifySuccess('Calendar updated');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Revision failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setBusy(false);
    }
  };

  const exportExcel = async () => {
    try {
      await downloadEntriesExcel(entries);
      notifySuccess('Excel downloaded');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed';
      notifyError(msg);
    }
  };

  const finish = () => {
    if (!entries.length) return;
    onComplete({
      entries,
      name: planName.trim() || `AI plan · ${label}`,
      runTime,
      timezone,
      executionMode,
    });
  };

  const entriesByDay = useMemo(() => {
    const map = new Map<string, AiWizardEntry[]>();
    for (const e of entries) {
      const list = map.get(e.date) || [];
      list.push(e);
      map.set(e.date, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  if (!open) return null;

  return (
    <div className="cal-ai-wizard" role="dialog" aria-modal="true" aria-labelledby="cal-ai-title">
      <div className="cal-ai-wizard-panel">
        <header className="flex items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="panel-kicker text-brand-600">AI content calendar</p>
            <h2 id="cal-ai-title" className="text-lg font-semibold tracking-tight sm:text-xl">
              Create calendar · {label}
            </h2>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              One card at a time — finishes only when you save.
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost min-h-[44px] md:!min-h-[40px] !px-3"
            onClick={onClose}
            disabled={busy && step === 'building'}
            aria-label="Close wizard"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 pt-3 sm:px-6">
          <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
            <div
              className="h-full rounded-full bg-brand-600 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
            Step {stepIndex(step) + 1} of {STEPS.length}
          </p>
        </div>

        <div className="cal-ai-wizard-body px-5 py-4 sm:px-6">
          {error && (
            <div className="mb-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</div>
          )}

          {step === 'intent' && (
            <div className="cal-ai-card animate-stage-in space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3 className="font-semibold">What should this month feel like?</h3>
                  <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                    Optional suggestions plus the content types you want. Next we set frequency.
                  </p>
                </div>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                  Your suggestions (optional)
                </span>
                <textarea
                  className="input min-h-[110px] resize-y"
                  placeholder="e.g. Focus on Q4 pipeline themes, one carousel on pricing myths, quieter weekends…"
                  value={suggestions}
                  onChange={(e) => setSuggestions(e.target.value)}
                />
              </label>
              <div>
                <p className="mb-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                  Content types
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {CONTENT_TYPES.map((t) => {
                    const on = contentTypes.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`cal-choice text-left !p-3 ${on ? 'cal-choice-on' : 'cal-choice-off'}`}
                        onClick={() => toggleType(t.id)}
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          {on && <Check size={14} className="text-brand-600" />}
                          {t.label}
                        </span>
                        <span className="mt-0.5 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">
                          {t.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <ProcessingButton
                  onClick={() => {
                    setError('');
                    setStep('cadence');
                  }}
                  icon={<ChevronRight size={16} />}
                >
                  Continue
                </ProcessingButton>
              </div>
            </div>
          )}

          {step === 'cadence' && (
            <div className="cal-ai-card animate-stage-in space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-700 dark:text-teal-300">
                  <CalendarDays size={20} />
                </div>
                <div>
                  <h3 className="font-semibold">How often should we post?</h3>
                  <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                    Frequency and carousel mix for {label}. AI uses your Settings brand, topics, and
                    competitors only.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                    Posts this month
                  </span>
                  <input
                    type="number"
                    className="input"
                    min={4}
                    max={60}
                    value={postsPerMonth}
                    onChange={(e) => setPostsPerMonth(Number(e.target.value) || 12)}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                    Carousel posts
                  </span>
                  <input
                    type="number"
                    className="input"
                    min={0}
                    max={postsPerMonth}
                    value={carouselCount}
                    onChange={(e) => setCarouselCount(Number(e.target.value) || 0)}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                    Slides per carousel
                  </span>
                  <input
                    type="number"
                    className="input"
                    min={3}
                    max={12}
                    value={carouselSlides}
                    onChange={(e) => setCarouselSlides(Number(e.target.value) || 6)}
                  />
                </label>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                  Prefer these days
                </p>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((d) => {
                    const on = preferredWeekdays.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold min-h-[40px] ${
                          on
                            ? 'border-brand-500/40 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                            : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
                        }`}
                        onClick={() => toggleDay(d.id)}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap justify-between gap-2 pt-2">
                <button type="button" className="btn-ghost" onClick={() => setStep('intent')}>
                  Back
                </button>
                <ProcessingButton
                  loading={busy}
                  loadingText="Starting…"
                  onClick={() => void buildPlan()}
                  icon={<Sparkles size={16} />}
                >
                  Build my calendar
                </ProcessingButton>
              </div>
            </div>
          )}

          {step === 'building' && (
            <div className="cal-ai-card animate-stage-in flex flex-col items-center justify-center gap-4 py-16 text-center">
              <Spinner size={28} />
              <div>
                <h3 className="font-semibold">Building {label}…</h3>
                <p className="mt-1 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">
                  Gathering company Settings, topics, competitors, and seasonal moments — then drafting
                  your plan.
                </p>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="cal-ai-card animate-stage-in space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Your draft calendar</h3>
                  <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                    {summary || `${entries.length} ideas for ${label}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1.5 min-h-[44px] md:!min-h-[40px]"
                  onClick={() => void exportExcel()}
                >
                  <Download size={15} />
                  Download Excel
                </button>
              </div>
              <div className="max-h-[min(48vh,420px)] space-y-2 overflow-y-auto rounded-2xl border border-[hsl(var(--border))] p-2">
                {entriesByDay.map(([date, list]) => (
                  <div key={date} className="rounded-xl bg-[hsl(var(--muted))]/40 px-3 py-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-brand-600">
                      {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                    <ul className="mt-1.5 space-y-2">
                      {list.map((e) => (
                        <li key={e.id} className="text-sm">
                          <p className="font-medium leading-snug">{e.title}</p>
                          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                            {e.theme || '—'}
                            {e.carouselSlideCount
                              ? ` · Carousel ${e.carouselSlideCount} slides`
                              : ''}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap justify-between gap-2 pt-1">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => setStep('cadence')}
                >
                  Rebuild
                </button>
                <div className="flex flex-wrap gap-2">
                  <ProcessingButton
                    variant="sector"
                    onClick={() => setStep('revise')}
                    icon={<MessageSquare size={16} />}
                  >
                    Modify with AI
                  </ProcessingButton>
                  <ProcessingButton
                    onClick={() => setStep('confirm')}
                    icon={<ChevronRight size={16} />}
                  >
                    Looks good
                  </ProcessingButton>
                </div>
              </div>
            </div>
          )}

          {step === 'revise' && (
            <div className="cal-ai-card animate-stage-in space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
                  <MessageSquare size={20} />
                </div>
                <div>
                  <h3 className="font-semibold">Tell the assistant what to change</h3>
                  <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                    One instruction card — e.g. “add two more carousels” or “remove weekend posts”.
                    Skip if you&apos;re happy.
                  </p>
                </div>
              </div>
              <textarea
                className="input min-h-[120px] resize-y"
                placeholder="What should change?"
                value={reviseText}
                onChange={(e) => setReviseText(e.target.value)}
                disabled={busy}
              />
              <div className="flex flex-wrap justify-between gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => setStep('preview')}
                >
                  Back to preview
                </button>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => setStep('confirm')}
                  >
                    Skip
                  </button>
                  <ProcessingButton
                    loading={busy}
                    loadingText="Updating…"
                    disabled={!reviseText.trim()}
                    onClick={() => void applyRevise()}
                    icon={<Sparkles size={16} />}
                  >
                    Apply changes
                  </ProcessingButton>
                </div>
              </div>
            </div>
          )}

          {step === 'confirm' && (
            <div className="cal-ai-card animate-stage-in space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <Save size={20} />
                </div>
                <div>
                  <h3 className="font-semibold">Ready to save?</h3>
                  <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                    {entries.length} idea{entries.length === 1 ? '' : 's'} for {label}. Choose how
                    generation should run, then save to your calendar.
                  </p>
                </div>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                  Plan name
                </span>
                <input
                  className="input"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className={`cal-choice text-left !p-3 ${
                    executionMode === 'automatic' ? 'cal-choice-on' : 'cal-choice-off'
                  }`}
                  onClick={() => setExecutionMode('automatic')}
                >
                  <span className="text-sm font-semibold">Automatic</span>
                  <span className="mt-0.5 block text-[11px] text-[hsl(var(--muted-foreground))]">
                    Generate on each post date at the time below
                  </span>
                </button>
                <button
                  type="button"
                  className={`cal-choice text-left !p-3 ${
                    executionMode === 'manual' ? 'cal-choice-on' : 'cal-choice-off'
                  }`}
                  onClick={() => setExecutionMode('manual')}
                >
                  <span className="text-sm font-semibold">Calendar only</span>
                  <span className="mt-0.5 block text-[11px] text-[hsl(var(--muted-foreground))]">
                    Save ideas; generate yourself from the grid
                  </span>
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                    Run time
                  </span>
                  <input
                    type="time"
                    className="input"
                    value={runTime}
                    onChange={(e) => setRunTime(e.target.value)}
                    disabled={executionMode === 'manual'}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                    Timezone
                  </span>
                  <select
                    className="input"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  >
                    {(timezones.length ? timezones : [timezone]).map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap justify-between gap-2 pt-1">
                <button type="button" className="btn-ghost" onClick={() => setStep('preview')}>
                  Back
                </button>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center gap-1.5"
                    onClick={() => void exportExcel()}
                  >
                    <Download size={15} />
                    Excel
                  </button>
                  <ProcessingButton onClick={finish} icon={<Save size={16} />}>
                    Save to calendar
                  </ProcessingButton>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { api, apiUpload } from '@/lib/api';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  LayoutTemplate,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { InlineNotice, ProcessOverlay, ProcessingButton } from '@/components/ui';
import { PlatformBadge } from '@/components/platform-badge';
import { CreativeModePicker, type CreativeVisualMode, CREATIVE_MODE_LABELS, CREATIVE_MODE_HINTS } from '@/components/creative-mode-picker';
import { abortContentGeneration, isAbortError } from '@/lib/abort';
import { notifyError, notifySuccess, toast } from '@/lib/toast';
import { CalendarAiWizard, type AiWizardEntry } from '@/components/calendar-ai-wizard';

type RegionId = 'india' | 'gcc' | 'europe' | 'usa' | 'global';
type CategoryId = 'tech' | 'festival' | 'national' | 'observance';

type FestivalEvent = {
  id: string;
  name: string;
  region: RegionId;
  category: CategoryId;
  date: string;
  description: string;
  hashtagHints: string[];
  promptHints: string;
};

type CustomPlanEntry = {
  id: string;
  date: string;
  title: string;
  theme: string;
  notes: string;
  hashtags: string[];
  carouselSlideCount?: number | null;
  planId?: string;
  executionMode?: 'automatic' | 'manual';
  status?: string;
  contentId?: string | null;
  errorMessage?: string | null;
};

function resolveCarouselSlides(entry: {
  title?: string;
  theme?: string;
  notes?: string;
  carouselSlideCount?: number | null;
}): number | null {
  if (entry.carouselSlideCount && entry.carouselSlideCount >= 2) {
    return Math.min(5, Math.max(2, entry.carouselSlideCount));
  }
  const text = [entry.title, entry.theme, entry.notes]
    .filter(Boolean)
    .join(' · ')
    .toLowerCase()
    .replace(/\bno\s+carousel\b/g, ' ')
    .replace(/\bno\s+carousal\b/g, ' ')
    .replace(/\bnot\s+a\s+carousel\b/g, ' ')
    .replace(/\bwithout\s+carousel\b/g, ' ');
  if (
    !/\bcarousel\b|\bcarousal\b|\bmulti[\s-]?slide\b|\bmulti[\s-]?page\b|\bslide\s*deck\b/.test(
      text,
    )
  ) {
    return null;
  }
  const m = text.match(
    /(?:carousel|carousal|slides?|pages?)[^0-9]{0,20}(\d{1,2})|(\d{1,2})\s*[-\s]?(?:slides?|pages?)/i,
  );
  const n = Number(m?.[1] || m?.[2] || 3);
  return Math.min(5, Math.max(2, Number.isFinite(n) ? n : 3));
}

function carouselChipLabel(entry: {
  title?: string;
  theme?: string;
  notes?: string;
  carouselSlideCount?: number | null;
}): string | null {
  const count = resolveCarouselSlides(entry);
  return count ? `Carousel · ${count}` : null;
}

function summarizeCarousels(
  entries: Array<{
    title?: string;
    theme?: string;
    notes?: string;
    carouselSlideCount?: number | null;
  }>,
): { posts: number; slides: number } {
  let posts = 0;
  let slides = 0;
  for (const entry of entries) {
    const n = resolveCarouselSlides(entry);
    if (!n) continue;
    posts += 1;
    slides += n;
  }
  return { posts, slides };
}

type SavedPlanEntry = {
  id: string;
  date: string;
  title: string;
  theme: string;
  notes?: string;
  status: string;
  runAt: string;
  contentId: string | null;
  errorMessage?: string | null;
};

type SavedPlan = {
  id: string;
  name: string;
  year: number;
  month: number;
  runTime: string;
  timezone: string;
  executionMode: 'automatic' | 'manual';
  visualMode: string;
  visualStyleId?: string;
  status: string;
  createdAt?: string;
  entries: SavedPlanEntry[];
};

/** Mirrors VISUAL_STYLE_PRESETS on the API; replaced by the live list once loaded. */
const PLAN_VISUAL_STYLES = [
  { id: 'professional_photo', label: 'Professional photo' },
  { id: 'cinematic_photo', label: 'Cinematic photo' },
  { id: 'illustration', label: 'Illustration' },
  { id: 'vector_flat', label: 'Vector / flat' },
  { id: '3d_render', label: '3D render' },
  { id: 'editorial_collage', label: 'Editorial collage' },
  { id: 'line_art', label: 'Line art' },
  { id: 'watercolor', label: 'Watercolor' },
];

const PLAN_TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Berlin', label: 'Berlin / CET' },
  { value: 'America/New_York', label: 'US Eastern' },
  { value: 'America/Los_Angeles', label: 'US Pacific' },
  { value: 'UTC', label: 'UTC' },
] as const;

type PlatformConn = {
  id: string;
  platform: string;
  accountName: string;
};

type BrandTemplateOption = {
  id: string;
  name: string;
  provider: string;
  isActive: boolean;
};

type ScheduledPost = {
  id: string;
  headline: string;
  status: string;
  scheduledAt: string | null;
  targetPlatforms: string[];
  sourceReference: string | null;
  createdAt: string;
  imageUrl: string | null;
};

const REGION_LABEL: Record<RegionId, string> = {
  india: 'India',
  gcc: 'GCC',
  europe: 'Europe',
  usa: 'USA',
  global: 'Global / Tech',
};

const REGION_COLOR: Record<RegionId, string> = {
  india: 'bg-orange-500/15 text-orange-800 border-orange-500/30 dark:text-orange-200',
  gcc: 'bg-emerald-500/15 text-emerald-800 border-emerald-500/30 dark:text-emerald-200',
  europe: 'bg-sky-500/15 text-sky-800 border-sky-500/30 dark:text-sky-200',
  usa: 'bg-violet-500/15 text-violet-800 border-violet-500/30 dark:text-violet-200',
  global: 'bg-slate-500/15 text-slate-800 border-slate-500/30 dark:text-slate-200',
};

const CATEGORY_LABEL: Record<CategoryId, string> = {
  tech: 'Tech',
  festival: 'Festival',
  national: 'National',
  observance: 'Observance',
};

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function firstWeekday(year: number, month: number) {
  // 0 = Sunday
  return new Date(year, month - 1, 1).getDay();
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultScheduleForEvent(dateStr: string) {
  const d = new Date(`${dateStr}T10:00:00`);
  if (d.getTime() < Date.now()) {
    d.setTime(Date.now() + 60 * 60 * 1000);
  }
  return toLocalInputValue(d);
}

export default function ContentCalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [regions, setRegions] = useState<RegionId[]>(['india', 'gcc', 'europe', 'usa', 'global']);
  const [categories, setCategories] = useState<CategoryId[]>([
    'tech',
    'festival',
    'national',
    'observance',
  ]);
  const [events, setEvents] = useState<FestivalEvent[]>([]);
  const [dayDrawer, setDayDrawer] = useState<{
    day: number;
    items: FestivalEvent[];
    customs?: CustomPlanEntry[];
  } | null>(null);
  const [entryPreview, setEntryPreview] = useState<CustomPlanEntry | null>(null);
  const [entryVisualMode, setEntryVisualMode] = useState<CreativeVisualMode | null>(null);
  const [entryBrandTemplateId, setEntryBrandTemplateId] = useState('');
  const [catalogSize, setCatalogSize] = useState(0);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [platforms, setPlatforms] = useState<PlatformConn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [selected, setSelected] = useState<FestivalEvent | null>(null);
  const [mode, setMode] = useState<'now' | 'scheduled'>('now');
  const [publishMode, setPublishMode] = useState<'review' | 'publish'>('review');
  const [visualMode, setVisualMode] = useState<CreativeVisualMode | null>('ai');
  const [brandTemplates, setBrandTemplates] = useState<BrandTemplateOption[]>([]);
  const [brandTemplateId, setBrandTemplateId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeGenIdRef = useRef<string | null>(null);

  // Default to Universal festival calendar so the catalog loads on first visit
  const [customPlanMode, setCustomPlanMode] = useState(false);
  const [planText, setPlanText] = useState('');
  const [planEntries, setPlanEntries] = useState<CustomPlanEntry[]>([]);
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [planWarnings, setPlanWarnings] = useState<string[]>([]);
  const [parsingPlan, setParsingPlan] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [planVisualMode, setPlanVisualMode] = useState<CreativeVisualMode>('ai');
  const [planVisualStyleId, setPlanVisualStyleId] = useState('professional_photo');
  const [visualStyleOptions, setVisualStyleOptions] = useState(PLAN_VISUAL_STYLES);
  const [planRunTime, setPlanRunTime] = useState('09:00');
  const [planTimezone, setPlanTimezone] = useState('Asia/Kolkata');
  const [planExecutionMode, setPlanExecutionMode] = useState<'automatic' | 'manual'>('automatic');
  const [planName, setPlanName] = useState('');
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [deletingPlanId, setDeletingPlanId] = useState('');
  const [generatingEntryId, setGeneratingEntryId] = useState('');
  const [aiWizardOpen, setAiWizardOpen] = useState(false);
  const [planTimezoneOptions, setPlanTimezoneOptions] = useState<string[]>(['Asia/Kolkata']);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const unsavedLeaveConfirmedRef = useRef(false);

  const loadMeta = useCallback(async () => {
    const metaRes = await api<{
      data: { platforms: PlatformConn[]; templates?: BrandTemplateOption[] };
    }>('/content/calendar/meta');
    setPlatforms(metaRes.data.platforms || []);
    setSelectedPlatforms((prev) =>
      prev.length ? prev : (metaRes.data.platforms || []).map((p) => p.platform),
    );
    const active = (metaRes.data.templates || []).filter((t) => t.isActive !== false);
    setBrandTemplates(active);
    setBrandTemplateId((prev) =>
      prev && active.some((t) => t.id === prev) ? prev : active[0]?.id || '',
    );
  }, []);

  const loadMonth = useCallback(async () => {
    if (customPlanMode) {
      setEvents([]);
      setScheduledPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({
        year: String(year),
        month: String(month),
        regions: regions.join(','),
        categories: categories.join(','),
      });
      const res = await api<{
        data: {
          events: FestivalEvent[];
          scheduledPosts: ScheduledPost[];
          catalogSize?: number;
        };
      }>(`/content/calendar/events?${qs}`);
      setEvents(res.data.events || []);
      setScheduledPosts(res.data.scheduledPosts || []);
      if (res.data.catalogSize) setCatalogSize(res.data.catalogSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load calendar');
    } finally {
      setLoading(false);
    }
  }, [year, month, regions, categories, customPlanMode]);

  const loadSavedPlan = useCallback(async () => {
    try {
      const res = await api<{
        data: {
          plans: SavedPlan[];
          active: SavedPlan | null;
          timezones?: Array<{ value: string; label: string }>;
          visualStyles?: Array<{ id: string; label: string }>;
        };
      }>(`/content/calendar/plan/saved?year=${year}&month=${month}`);
      setSavedPlans(res.data.plans || []);
      if (res.data.timezones?.length) {
        setPlanTimezoneOptions(res.data.timezones.map((t) => t.value));
      }
      if (res.data.visualStyles?.length) setVisualStyleOptions(res.data.visualStyles);
      if (res.data.active?.visualStyleId) setPlanVisualStyleId(res.data.active.visualStyleId);
      if (res.data.active?.runTime) setPlanRunTime(res.data.active.runTime);
      if (res.data.active?.timezone) setPlanTimezone(res.data.active.timezone);
      if (res.data.active?.executionMode) {
        setPlanExecutionMode(res.data.active.executionMode);
      }
      if (
        res.data.active?.visualMode === 'existing_template' ||
        res.data.active?.visualMode === 'ai' ||
        res.data.active?.visualMode === 'ai_baked_layout'
      ) {
        setPlanVisualMode(res.data.active.visualMode);
      }
    } catch {
      setSavedPlans([]);
    }
  }, [year, month]);

  useEffect(() => {
    void loadMeta().catch(() => undefined);
  }, [loadMeta]);

  useEffect(() => {
    void loadMonth();
  }, [loadMonth]);

  useEffect(() => {
    if (customPlanMode) void loadSavedPlan();
  }, [customPlanMode, loadSavedPlan]);

  useEffect(() => {
    if (!planEntries.length) return;
    unsavedLeaveConfirmedRef.current = false;

    const message = 'You have an unsaved uploaded content plan. Leave without saving?';
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (unsavedLeaveConfirmedRef.current) return;
      event.preventDefault();
      event.returnValue = message;
      return message;
    };
    const interceptNavigation = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname
      ) {
        return;
      }
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        unsavedLeaveConfirmedRef.current = true;
      }
    };

    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', interceptNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', interceptNavigation, true);
    };
  }, [planEntries.length]);

  const eventsByDay = useMemo(() => {
    const map = new Map<number, FestivalEvent[]>();
    for (const ev of events) {
      const day = Number(ev.date.split('-')[2]);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(ev);
    }
    return map;
  }, [events]);

  const displayPlanEntries = useMemo(() => {
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;
    const uploaded = planEntries.filter((entry) => entry.date.startsWith(prefix));
    const saved = savedPlans.length
      ? savedPlans.flatMap((plan) =>
        plan.entries
          .filter((entry) => entry.date.startsWith(prefix))
          .map((entry) => ({
            id: entry.id,
            date: entry.date,
            title: entry.title,
            theme: entry.theme || '',
            notes: entry.notes || entry.errorMessage || '',
            hashtags: [] as string[],
            planId: plan.id,
            executionMode: plan.executionMode,
            status: entry.status,
            contentId: entry.contentId,
            errorMessage: entry.errorMessage,
          })),
        )
      : [];
    return [...saved, ...uploaded] as CustomPlanEntry[];
  }, [planEntries, savedPlans, year, month]);

  const customByDay = useMemo(() => {
    const map = new Map<number, CustomPlanEntry[]>();
    for (const entry of displayPlanEntries) {
      const day = Number(entry.date.split('-')[2]);
      if (!day) continue;
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(entry);
    }
    return map;
  }, [displayPlanEntries]);

  const selectedPlanEntries = useMemo(
    () => planEntries.filter((e) => selectedPlanIds.includes(e.id)),
    [planEntries, selectedPlanIds],
  );
  const currentUploadedEntries = useMemo(() => {
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;
    return planEntries.filter((entry) => entry.date.startsWith(prefix));
  }, [planEntries, year, month]);
  const selectedCurrentEntries = useMemo(
    () => currentUploadedEntries.filter((entry) => selectedPlanIds.includes(entry.id)),
    [currentUploadedEntries, selectedPlanIds],
  );
  const uploadedCarouselStats = useMemo(
    () => summarizeCarousels(currentUploadedEntries),
    [currentUploadedEntries],
  );
  const selectedCarouselStats = useMemo(
    () => summarizeCarousels(selectedPlanEntries),
    [selectedPlanEntries],
  );

  const totalDays = daysInMonth(year, month);
  const offset = firstWeekday(year, month);
  const cells = Array.from({ length: offset + totalDays }, (_, i) =>
    i < offset ? null : i - offset + 1,
  );

  const agendaDays = useMemo(() => {
    const days: Array<{
      day: number;
      isToday: boolean;
      events: FestivalEvent[];
      customs: CustomPlanEntry[];
    }> = [];
    for (let day = 1; day <= totalDays; day++) {
      const dayEvents = customPlanMode ? [] : eventsByDay.get(day) || [];
      const dayCustoms = customPlanMode ? customByDay.get(day) || [] : [];
      if (!dayEvents.length && !dayCustoms.length) continue;
      days.push({
        day,
        isToday:
          day === now.getDate() &&
          month === now.getMonth() + 1 &&
          year === now.getFullYear(),
        events: dayEvents,
        customs: dayCustoms,
      });
    }
    return days;
  }, [totalDays, customPlanMode, eventsByDay, customByDay, month, year]);

  const monthLabel = new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const openEvent = (ev: FestivalEvent) => {
    setSelected(ev);
    setMode('now');
    setPublishMode('review');
    // Default creative so Generate is enabled immediately
    setVisualMode((prev) => prev || 'ai');
    setScheduledAt(defaultScheduleForEvent(ev.date));
    setOkMsg('');
    setError('');
    void loadMeta().catch(() => undefined);
  };

  const toggleRegion = (id: RegionId) => {
    setRegions((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((r) => r !== id);
        return next.length ? next : prev;
      }
      return [...prev, id];
    });
  };

  const toggleCategory = (id: CategoryId) => {
    setCategories((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((c) => c !== id);
        return next.length ? next : prev;
      }
      return [...prev, id];
    });
  };

  const parsePlan = async (textOverride?: string, replacingConfirmed = false) => {
    const text = (textOverride ?? planText).trim();
    if (!text) {
      const msg = 'Paste a month plan or upload a CSV/TXT file first.';
      setError(msg);
      toast.error(msg);
      return;
    }
    if (
      planEntries.length &&
      !replacingConfirmed &&
      !window.confirm('Replace the current unsaved workbook content?')
    ) {
      return;
    }
    setParsingPlan(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{
        data: {
          entries: CustomPlanEntry[];
          warnings: string[];
          companyName: string;
          totalParsed: number;
        };
      }>('/content/calendar/plan/parse', {
        method: 'POST',
        body: {
          text,
          year,
          month,
          monthOnly: false,
        },
      });
      setPlanEntries(res.data.entries || []);
      setSelectedPlanIds((res.data.entries || []).map((e) => e.id));
      setPlanWarnings(res.data.warnings || []);
      setCompanyName(res.data.companyName || '');
      if (!(res.data.entries || []).length) {
        setError(res.data.warnings?.[0] || 'No dated ideas found for this month.');
      } else {
        setOkMsg(
          `${res.data.entries.length} ideas ready for ${res.data.companyName || 'your brand'} · select, set time, then save.`,
        );
        notifySuccess('Plan ready');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to parse plan';
      setError(msg);
      notifyError(msg);
    } finally {
      setParsingPlan(false);
    }
  };

  const onPlanFile = async (file: File | null) => {
    if (!file) return;
    if (
      planEntries.length &&
      !window.confirm('Replace the current unsaved workbook content with this file?')
    ) {
      return;
    }
    const lower = file.name.toLowerCase();
    const isExcel = /\.xlsx?$/.test(lower);
    setPlanName(file.name.replace(/\.(xlsx?|csv|tsv|txt)$/i, ''));
    setParsingPlan(true);
    setError('');
    setOkMsg('');
    try {
      if (isExcel) {
        const fd = new FormData();
        fd.append('file', file);
        const qs = new URLSearchParams({
          year: String(year),
          month: String(month),
          monthOnly: 'false',
        });
        const res = await apiUpload<{
          data: {
            entries: CustomPlanEntry[];
            warnings: string[];
            companyName: string;
            fileName?: string;
          };
        }>(`/content/calendar/plan/upload?${qs}`, fd);
        setPlanEntries(res.data.entries || []);
        setSelectedPlanIds((res.data.entries || []).map((e) => e.id));
        setPlanWarnings(res.data.warnings || []);
        setCompanyName(res.data.companyName || '');
        setPlanText('');
        if (!(res.data.entries || []).length) {
          setError(res.data.warnings?.[0] || 'No dated ideas found for this month.');
        } else {
          setOkMsg(
            `Excel loaded · ${res.data.entries.length} ideas for ${res.data.companyName || 'your brand'}. Select, set time, then save.`,
          );
          notifySuccess('Excel plan ready');
        }
      } else {
        const text = await file.text();
        setPlanText(text);
        await parsePlan(text, true);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not read that file.';
      setError(msg);
      notifyError(msg);
    } finally {
      setParsingPlan(false);
    }
  };

  const downloadExcelTemplate = () => {
    window.open(
      `/api/content/calendar/plan/template.xlsx?year=${year}&month=${month}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  const discardUnsavedPlan = () => {
    if (
      planEntries.length &&
      !window.confirm(`Discard ${planEntries.length} unsaved Excel row(s)?`)
    ) {
      return;
    }
    setPlanEntries([]);
    setSelectedPlanIds([]);
    setPlanWarnings([]);
    setPlanText('');
    setPlanName('');
    setOkMsg('Unsaved workbook discarded.');
  };

  const togglePlanEntry = (id: string) => {
    setSelectedPlanIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const saveCustomPlan = async () => {
    if (!selectedPlanEntries.length) {
      const msg = 'Select at least one calendar idea to save.';
      setError(msg);
      toast.error(msg);
      return;
    }
    if (planVisualMode === 'existing_template' && !brandTemplateId) {
      const msg = `Pick a Brand Studio template, or switch to ${CREATIVE_MODE_LABELS.ai} / ${CREATIVE_MODE_LABELS.ai_baked_layout}.`;
      setError(msg);
      toast.error(msg);
      return;
    }
    if (
      planExecutionMode === 'automatic' &&
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(planRunTime)
    ) {
      const msg = 'Choose a valid start time (HH:mm).';
      setError(msg);
      toast.error(msg);
      return;
    }
    setSavingPlan(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{
        data: { plan: SavedPlan; companyName: string; message: string };
      }>('/content/calendar/plan/save', {
        method: 'POST',
        body: {
          year,
          month,
          name: planName.trim() || undefined,
          source: 'upload',
          runTime: planRunTime,
          timezone: planTimezone,
          executionMode: planExecutionMode,
          entries: selectedPlanEntries,
          visualMode: planVisualMode,
          visualStyleId: planVisualStyleId,
          brandTemplateId: planVisualMode === 'existing_template' ? brandTemplateId : null,
        },
      });
      setOkMsg(res.data.message);
      notifySuccess('Plan saved');
      setPlanEntries([]);
      setSelectedPlanIds([]);
      setPlanText('');
      setPlanName('');
      await loadMonth();
      await loadSavedPlan();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save plan';
      setError(msg);
      notifyError(msg);
    } finally {
      setSavingPlan(false);
    }
  };

  const saveAiWizardPlan = async (payload: {
    entries: AiWizardEntry[];
    name: string;
    runTime: string;
    timezone: string;
    executionMode: 'automatic' | 'manual';
  }) => {
    setSavingPlan(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{
        data: { plan: SavedPlan; companyName: string; message: string };
      }>('/content/calendar/plan/save', {
        method: 'POST',
        body: {
          year,
          month,
          name: payload.name,
          source: 'ai',
          runTime: payload.runTime,
          timezone: payload.timezone,
          executionMode: payload.executionMode,
          entries: payload.entries.map((e) => ({
            id: e.id,
            date: e.date,
            title: e.title,
            theme: e.theme,
            notes: e.notes,
            hashtags: e.hashtags,
          })),
          visualMode: 'ai',
          visualStyleId: planVisualStyleId,
          brandTemplateId: null,
        },
      });
      setAiWizardOpen(false);
      setCustomPlanMode(true);
      setOkMsg(res.data.message);
      notifySuccess('AI calendar saved');
      setPlanEntries([]);
      setSelectedPlanIds([]);
      await loadMonth();
      await loadSavedPlan();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save AI calendar';
      setError(msg);
      notifyError(msg);
    } finally {
      setSavingPlan(false);
    }
  };

  const deleteSavedPlan = async (plan: SavedPlan) => {
    if (!window.confirm(`Delete "${plan.name}" and stop its unprocessed scheduled entries?`)) {
      return;
    }
    setDeletingPlanId(plan.id);
    setError('');
    try {
      await api(`/content/calendar/plan/saved/${plan.id}`, { method: 'DELETE' });
      notifySuccess('Saved calendar deleted');
      await loadSavedPlan();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not delete saved calendar';
      setError(msg);
      notifyError(msg);
    } finally {
      setDeletingPlanId('');
    }
  };

  const canRegenerateEntry = (entry: CustomPlanEntry) =>
    ['manual', 'failed'].includes(entry.status || '');

  const openEntryPreview = (entry: CustomPlanEntry) => {
    setEntryPreview(entry);
    if (canRegenerateEntry(entry) && entry.planId) {
      const preferred: CreativeVisualMode | null =
        planVisualMode === 'existing_template' && brandTemplates.length
          ? 'existing_template'
          : planVisualMode === 'ai_baked_layout'
            ? 'ai_baked_layout'
            : planVisualMode === 'ai'
              ? 'ai'
              : brandTemplates.length
                ? null
                : 'ai';
      setEntryVisualMode(preferred);
      setEntryBrandTemplateId((prev) => {
        if (prev && brandTemplates.some((t) => t.id === prev)) return prev;
        return brandTemplates[0]?.id || '';
      });
    } else {
      setEntryVisualMode(null);
      setEntryBrandTemplateId('');
    }
  };

  const openCustomEntry = async (entry: CustomPlanEntry) => {
    if (!entry.planId) {
      togglePlanEntry(entry.id);
      return;
    }
    if (entry.status === 'ready' && entry.contentId) {
      window.location.href = `/approvals/${entry.contentId}`;
      return;
    }
    if (!canRegenerateEntry(entry)) {
      return;
    }
    if (!entryVisualMode) {
      const msg = `Choose ${CREATIVE_MODE_LABELS.existing_template}, ${CREATIVE_MODE_LABELS.ai}, or ${CREATIVE_MODE_LABELS.ai_baked_layout} before generating.`;
      setError(msg);
      notifyError(msg);
      return;
    }
    if (entryVisualMode === 'existing_template' && !entryBrandTemplateId) {
      const msg = `Pick a Brand Studio template, or switch to ${CREATIVE_MODE_LABELS.ai} / ${CREATIVE_MODE_LABELS.ai_baked_layout}.`;
      setError(msg);
      notifyError(msg);
      return;
    }

    setGeneratingEntryId(entry.id);
    setError('');
    try {
      const res = await api<{ data: { contentId: string; message: string } }>(
        `/content/calendar/plan/saved/${entry.planId}/entries/${entry.id}/generate`,
        {
          method: 'POST',
          body: {
            visualMode: entryVisualMode,
            brandTemplateId:
              entryVisualMode === 'existing_template' ? entryBrandTemplateId : null,
          },
        },
      );
      setEntryPreview(null);
      setOkMsg(res.data.message);
      notifySuccess('Generation started');
      if (res.data.contentId) {
        window.location.href = `/approvals/${res.data.contentId}`;
        return;
      }
      await loadSavedPlan();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not generate this entry';
      setError(msg);
      notifyError(msg);
    } finally {
      setGeneratingEntryId('');
    }
  };

  const needsChannels = mode === 'scheduled' || (mode === 'now' && publishMode === 'publish');
  const canSubmit =
    Boolean(visualMode) &&
    (visualMode !== 'existing_template' || Boolean(brandTemplateId)) &&
    (!needsChannels || selectedPlatforms.length > 0);

  const cancelGenerate = async () => {
    abortRef.current?.abort();
    const genId = activeGenIdRef.current;
    activeGenIdRef.current = null;
    setSubmitting(false);
    if (genId) {
      try {
        await abortContentGeneration(genId);
        setOkMsg('Generation aborted.');
        notifySuccess('Aborted');
      } catch {
        setOkMsg('Stopped waiting.');
      }
    }
  };

  const submitGenerate = async () => {
    if (!selected) return;
    const event = selected;
    if (!visualMode) {
      const msg = 'Choose an existing Brand Studio template or Generate entire by AI.';
      setError(msg);
      toast.error(msg);
      return;
    }
    if (visualMode === 'existing_template' && !brandTemplateId) {
      const msg = 'Pick a Brand Studio template, or switch to Generate entire by AI.';
      setError(msg);
      toast.error(msg);
      return;
    }
    if (needsChannels && !selectedPlatforms.length) {
      const msg = 'Select at least one connected channel to publish or schedule.';
      setError(msg);
      toast.error(msg);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    activeGenIdRef.current = null;
    setSubmitting(true);
    setError('');
    setOkMsg('');
    // Close festival modal so ProcessOverlay (Abort) sits on top and is usable
    setSelected(null);
    try {
      const res = await api<{
        data: { contentId: string; mode: string; publishMode: string };
      }>('/content/calendar/generate', {
        method: 'POST',
        body: {
          eventId: event.id,
          eventYear: Number(event.date.slice(0, 4)) || year,
          mode,
          publishMode: mode === 'now' ? publishMode : 'review',
          scheduledAt:
            mode === 'scheduled'
              ? new Date(scheduledAt).toISOString()
              : null,
          platforms: selectedPlatforms,
          visualMode,
          useBrandTemplate: visualMode === 'existing_template',
          brandTemplateId: visualMode === 'existing_template' ? brandTemplateId : null,
        },
        signal: ac.signal,
      });

      const id = res.data.contentId;
      activeGenIdRef.current = id;
      if (mode === 'scheduled') {
        setOkMsg(`Scheduled generation started. Post will publish at the chosen time.`);
        notifySuccess('Scheduled');
        setSelected(null);
        await loadMonth();
      } else if (publishMode === 'publish') {
        setOkMsg(`Generating & publishing… Track in Approvals / Logs.`);
        notifySuccess('Generation started');
        // Keep overlay while worker runs so Abort is available
        const deadline = Date.now() + 3 * 60 * 1000;
        while (Date.now() < deadline) {
          if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          await new Promise((r) => setTimeout(r, 2500));
          if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const status = await api<{ data: { status: string } }>(`/content/${id}`, {
            signal: ac.signal,
          });
          if (['pending_approval', 'published', 'publishing', 'scheduled', 'rejected', 'failed'].includes(status.data.status)) {
            break;
          }
        }
        setSelected(null);
      } else {
        setOkMsg(`Generating for review…`);
        notifySuccess('Generation started');
        const deadline = Date.now() + 3 * 60 * 1000;
        while (Date.now() < deadline) {
          if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          await new Promise((r) => setTimeout(r, 2500));
          if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const status = await api<{ data: { status: string } }>(`/content/${id}`, {
            signal: ac.signal,
          });
          if (status.data.status === 'pending_approval') {
            window.location.href = `/approvals/${id}`;
            return;
          }
          if (status.data.status === 'rejected') {
            setOkMsg('Generation aborted.');
            return;
          }
          if (status.data.status === 'failed') break;
        }
        setSelected(null);
        window.location.href = `/approvals/${id}`;
      }
    } catch (e) {
      if (isAbortError(e)) {
        setOkMsg('Generation aborted.');
        notifySuccess('Aborted');
      } else {
        const msg = e instanceof Error ? e.message : 'Generate failed';
        setError(msg);
        notifyError(msg);
      }
    } finally {
      activeGenIdRef.current = null;
      setSubmitting(false);
    }
  };

  return (
    <AuthGuard>
      <div className="page-container animate-page-enter">
        <header className="page-header">
          <div className="min-w-0">
            <p className="panel-kicker mb-1">Editorial calendar</p>
            <h1 className="page-title">Content Calendar</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
              {customPlanMode
                ? `Only your uploaded Excel plans appear here. Save as Automatic to generate on each exact date/time, or Calendar Only to generate entries yourself.`
                : `Browse seasonal moments and tech observances, then craft on-brand posts for review${
                    events.length ? ` · ${events.length} moments this month` : ''
                  }.`}
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 sm:flex">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600">
              <CalendarDays size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">{monthLabel}</p>
              <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                {customPlanMode
                  ? `${displayPlanEntries.length} uploaded idea${displayPlanEntries.length === 1 ? '' : 's'}`
                  : catalogSize
                    ? `${catalogSize}+ catalog moments`
                    : 'Built-in catalog'}
              </p>
            </div>
          </div>
        </header>

        <div className="cal-stagger space-y-5">
          {(error || okMsg) && (
            <InlineNotice kind={error ? 'error' : 'success'}>{error || okMsg}</InlineNotice>
          )}

          <section className="panel overflow-hidden">
            <div className="panel-body !py-4">
              <p className="panel-kicker mb-3">Choose a calendar</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <button
                  type="button"
                  className="cal-choice cal-choice-off text-left"
                  onClick={() => {
                    setCustomPlanMode(true);
                    setError('');
                    setOkMsg('');
                    setAiWizardOpen(true);
                  }}
                >
                  <span className="mb-2 inline-flex items-center gap-2 rounded-full border border-brand-500/25 bg-brand-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-800 dark:text-brand-200">
                    <Sparkles size={12} />
                    AI assistant
                  </span>
                  <span className="block text-base font-semibold">Create a content calendar</span>
                  <span className="mt-1.5 block text-xs font-normal leading-relaxed text-[hsl(var(--muted-foreground))]">
                    Card-by-card wizard — uses Settings brand, topics & competitors, then save.
                  </span>
                </button>
                <button
                  type="button"
                  className={`cal-choice cal-mode-plan ${customPlanMode ? 'cal-choice-on' : 'cal-choice-off'}`}
                  onClick={() => {
                    setCustomPlanMode(true);
                    setError('');
                    setOkMsg('');
                  }}
                >
                  <span className="mb-2 inline-flex items-center gap-2 rounded-full border border-teal-500/25 bg-teal-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-teal-800 dark:text-teal-200">
                    <FileSpreadsheet size={12} />
                    Your uploads
                  </span>
                  <span className="block text-base font-semibold">My content plans</span>
                  <span className="mt-1.5 block text-xs font-normal leading-relaxed text-[hsl(var(--muted-foreground))]">
                    Excel / CSV ideas you upload. Teal cards on the grid = your plan only.
                  </span>
                </button>
                <button
                  type="button"
                  className={`cal-choice cal-mode-festival ${!customPlanMode ? 'cal-choice-on' : 'cal-choice-off'}`}
                  onClick={() => {
                    setCustomPlanMode(false);
                    setError('');
                    setOkMsg('');
                    setPlanWarnings([]);
                  }}
                >
                  <span className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-900 dark:text-amber-100">
                    <CalendarDays size={12} />
                    Catalog
                  </span>
                  <span className="block text-base font-semibold">Universal festival calendar</span>
                  <span className="mt-1.5 block text-xs font-normal leading-relaxed text-[hsl(var(--muted-foreground))]">
                    Country festivals & observances. Amber / region colors — inactive until you open one.
                  </span>
                </button>
              </div>
            </div>
          </section>

          {customPlanMode ? (
            <section className="panel cal-surface-plan animate-stage-in overflow-hidden">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker text-teal-700 dark:text-teal-300">My content · Step 1</p>
                  <p className="panel-title">Upload your content-plan workbook</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ProcessingButton
                    variant="sector"
                    className="min-h-[44px] md:!min-h-[40px]"
                    icon={<Sparkles size={15} />}
                    onClick={() => {
                      setCustomPlanMode(true);
                      setError('');
                      setOkMsg('');
                      setAiWizardOpen(true);
                    }}
                  >
                    Create a content calendar
                  </ProcessingButton>
                  {planEntries.length > 0 && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm inline-flex items-center gap-1.5 text-red-600"
                      onClick={discardUnsavedPlan}
                    >
                      <Trash2 size={14} />
                      Discard upload
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary btn-sm inline-flex items-center gap-1.5"
                    onClick={downloadExcelTemplate}
                  >
                    <Download size={14} />
                    Excel template
                  </button>
                </div>
              </div>
              <div className="panel-body space-y-5">
                <div className="cal-hero">
                  <div className="relative z-[1] space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/25 bg-teal-500/10 px-2.5 py-1 text-[11px] font-semibold text-teal-800 dark:text-teal-200">
                      <FileSpreadsheet size={12} />
                      Excel · CSV upload
                    </div>
                    <p className="max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                      Drop an <strong className="font-semibold text-[hsl(var(--foreground))]">.xlsx</strong> or
                      CSV. We read exact <strong className="font-semibold text-[hsl(var(--foreground))]">dates</strong>,{' '}
                      <strong className="font-semibold text-[hsl(var(--foreground))]">titles</strong>, pillar, hook,
                      angle, and CTA — then you <strong className="font-semibold text-[hsl(var(--foreground))]">save</strong>.
                      Teal cards on the month grid are only your plan.
                    </p>
                  </div>
                </div>

                <div
                  className="cal-dropzone"
                  data-active={parsingPlan ? 'true' : 'false'}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.dataset.active = 'true';
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.dataset.active = 'false';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.dataset.active = 'false';
                    const f = e.dataTransfer.files?.[0] || null;
                    void onPlanFile(f);
                  }}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-700 animate-float dark:text-teal-300">
                    <Upload size={22} />
                  </div>
                  <p className="text-sm font-semibold">Drop Excel here, or browse</p>
                  <p className="helper-text">
                    Preferred: .xlsx with columns date, title, theme, opening hook, angle, cta,
                    format (e.g. Carousel (4 slides) — 2–5 slides). Or build one ad‑hoc in{' '}
                    <Link href="/carousel" className="text-brand-600 underline">
                      Carousel
                    </Link>
                    .
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv,.txt,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        void onPlanFile(f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      className="btn-secondary btn-sm inline-flex items-center gap-1.5"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={parsingPlan}
                    >
                      <FileSpreadsheet size={14} />
                      {parsingPlan ? 'Reading file…' : 'Upload Excel / CSV'}
                    </button>
                  </div>
                </div>

                {planWarnings.length > 0 && (
                  <ul className="space-y-1 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-800 animate-fade-in dark:text-amber-200">
                    {planWarnings.slice(0, 6).map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                {planEntries.length > 0 && (
                  <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 px-3 py-2.5 text-xs text-teal-900 dark:text-teal-100">
                    <strong>{planEntries.length} unsaved Excel row(s) loaded.</strong> Browse months
                    freely—the upload remains here. You’ll be warned before leaving this page.
                  </div>
                )}
                {planEntries.length > 0 && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--border))] pt-4">
                      <div>
                        <p className="panel-kicker">Step 2 · Select</p>
                        <p className="text-sm font-medium">
                          {selectedCurrentEntries.length} of {currentUploadedEntries.length} for {monthLabel}
                          <span className="ml-1 text-[hsl(var(--muted-foreground))]">
                            · {selectedPlanEntries.length} selected across workbook
                          </span>
                        </p>
                        {(uploadedCarouselStats.posts > 0 || selectedCarouselStats.posts > 0) && (
                          <p className="mt-1 text-xs text-teal-800 dark:text-teal-200">
                            Carousels in this month: <strong>{uploadedCarouselStats.posts}</strong>
                            {uploadedCarouselStats.posts > 0
                              ? ` · ~${uploadedCarouselStats.slides} images`
                              : ''}
                            {selectedCarouselStats.posts > 0 ? (
                              <>
                                {' '}
                                · selected will generate{' '}
                                <strong>{selectedCarouselStats.posts}</strong> carousel
                                {selectedCarouselStats.posts === 1 ? '' : 's'} (~
                                {selectedCarouselStats.slides} slides)
                              </>
                            ) : null}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() =>
                            setSelectedPlanIds((previous) => [
                              ...new Set([
                                ...previous,
                                ...currentUploadedEntries.map((entry) => entry.id),
                              ]),
                            ])
                          }
                        >
                          Select month
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() =>
                            setSelectedPlanIds((previous) =>
                              previous.filter(
                                (id) => !currentUploadedEntries.some((entry) => entry.id === id),
                              ),
                            )
                          }
                        >
                          Clear month
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => setSelectedPlanIds(planEntries.map((entry) => entry.id))}
                        >
                          Select workbook
                        </button>
                      </div>
                    </div>
                    <ul className="max-h-80 space-y-2 overflow-y-auto pr-0.5">
                      {currentUploadedEntries.map((entry, idx) => {
                        const on = selectedPlanIds.includes(entry.id);
                        return (
                          <li key={entry.id} style={{ animationDelay: `${Math.min(idx, 12) * 0.03}s` }}>
                            <button
                              type="button"
                              onClick={() => togglePlanEntry(entry.id)}
                              className={`cal-entry ${on ? 'cal-entry-on border-teal-500 bg-teal-500/[0.06]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`}
                            >
                              <span
                                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold transition-colors ${
                                  on
                                    ? 'border-teal-600 bg-teal-600 text-white'
                                    : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'
                                }`}
                              >
                                {on ? '✓' : ''}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                                  {entry.date}
                                  {entry.theme ? ` · ${entry.theme}` : ''}
                                </span>
                                <span className="mt-0.5 block text-sm font-semibold leading-snug">
                                  {entry.title}
                                </span>
                                {carouselChipLabel(entry) ? (
                                  <span className="mt-1 inline-flex rounded-md border border-teal-500/35 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-200">
                                    {carouselChipLabel(entry)}
                                  </span>
                                ) : null}
                                {entry.notes ? (
                                  <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                                    {entry.notes}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                      {!currentUploadedEntries.length && (
                        <li className="rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-5 text-center text-xs text-[hsl(var(--muted-foreground))]">
                          No uploaded Excel rows for {monthLabel}. Navigate to another month; the
                          unsaved workbook remains loaded.
                        </li>
                      )}
                    </ul>

                    <div className="space-y-3 border-t border-[hsl(var(--border))] pt-4">
                      <div>
                        <p className="panel-kicker">Step 3 · Workflow & visual</p>
                        <p className="field-label !mb-0">How should this plan run?</p>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          className={`cal-choice ${planExecutionMode === 'automatic' ? 'cal-choice-on' : 'cal-choice-off'}`}
                          onClick={() => setPlanExecutionMode('automatic')}
                        >
                          <Clock size={16} className="mb-1.5 text-brand-600" />
                          <span className="block text-sm font-semibold">Automatic</span>
                          <span className="mt-1 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">
                            Generate each entry on its Excel date and chosen time
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`cal-choice ${planExecutionMode === 'manual' ? 'cal-choice-on' : 'cal-choice-off'}`}
                          onClick={() => setPlanExecutionMode('manual')}
                        >
                          <FileSpreadsheet size={16} className="mb-1.5 text-brand-600" />
                          <span className="block text-sm font-semibold">Calendar only</span>
                          <span className="mt-1 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">
                            Save ideas only; generate an entry when you choose
                          </span>
                        </button>
                      </div>
                      <label className="block space-y-1.5">
                        <span className="field-label !mb-0">Calendar name</span>
                        <input
                          className="input"
                          value={planName}
                          onChange={(e) => setPlanName(e.target.value)}
                          placeholder={`e.g. ${monthLabel} LinkedIn plan`}
                          maxLength={120}
                        />
                      </label>
                      {planExecutionMode === 'automatic' && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="block space-y-1.5">
                          <span className="field-label !mb-0">Start time</span>
                          <input
                            type="time"
                            className="input"
                            value={planRunTime}
                            onChange={(e) => setPlanRunTime(e.target.value)}
                          />
                        </label>
                        <label className="block space-y-1.5">
                          <span className="field-label !mb-0">Timezone</span>
                          <select
                            className="input"
                            value={planTimezone}
                            onChange={(e) => setPlanTimezone(e.target.value)}
                          >
                            {PLAN_TIMEZONES.map((tz) => (
                              <option key={tz.value} value={tz.value}>
                                {tz.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      )}
                      <p className="helper-text">
                        {planExecutionMode === 'automatic'
                          ? 'On each Excel date, ContentPilot creates the draft at this time. Finished posts land in Approvals.'
                          : 'Nothing is generated automatically. Open an entry in your calendar and choose Generate when ready.'}
                        {' '}Nothing publishes without approval.
                      </p>
                      <CreativeModePicker
                        value={planVisualMode}
                        onChange={setPlanVisualMode}
                        brandTemplatesCount={brandTemplates.length}
                      />
                      {planVisualMode === 'existing_template' && (
                        <select
                          className="input"
                          value={brandTemplateId}
                          onChange={(e) => setBrandTemplateId(e.target.value)}
                        >
                          {brandTemplates.length === 0 ? (
                            <option value="">No active templates</option>
                          ) : (
                            brandTemplates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))
                          )}
                        </select>
                      )}
                      {(planVisualMode === 'ai' || planVisualMode === 'ai_baked_layout') && (
                        <label className="block space-y-1.5">
                          <span className="field-label !mb-0">Art style for every post</span>
                          <select
                            className="input"
                            value={planVisualStyleId}
                            onChange={(e) => setPlanVisualStyleId(e.target.value)}
                          >
                            {visualStyleOptions.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                          <span className="helper-text">
                            {planVisualMode === 'ai_baked_layout'
                              ? CREATIVE_MODE_HINTS.ai_baked_layout
                              : 'One consistent style across the month. LLM layout + AI photo; brand palette on overlays.'}
                          </span>
                        </label>
                      )}
                    </div>

                    <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-20 -mx-1 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/95 p-3 shadow-lg backdrop-blur animate-slide-down md:bottom-2">
                      <ProcessingButton
                        onClick={() => void saveCustomPlan()}
                        loading={savingPlan}
                        loadingText={`Saving ${selectedPlanEntries.length} ideas…`}
                        disabled={!selectedPlanEntries.length}
                        className="w-full"
                        icon={<Save size={14} />}
                      >
                        {selectedPlanEntries.length
                          ? planExecutionMode === 'automatic'
                            ? `Save ${selectedPlanEntries.length} idea${selectedPlanEntries.length === 1 ? '' : 's'} · auto at ${planRunTime}`
                            : `Save ${selectedPlanEntries.length} idea${selectedPlanEntries.length === 1 ? '' : 's'} · calendar only`
                          : 'Select ideas to save'}
                      </ProcessingButton>
                      <p className="helper-text mt-2 text-center">
                        {planExecutionMode === 'automatic'
                          ? 'Drafts are created on each date, then wait in Approvals.'
                          : 'Ideas stay in the calendar until you generate them.'}
                      </p>
                    </div>
                  </>
                )}

                {savedPlans.length > 0 && (
                  <div className="space-y-3 border-t border-[hsl(var(--border))] pt-4">
                    <div>
                      <p className="panel-kicker">Saved calendars</p>
                      <p className="text-sm font-medium">
                        {savedPlans.length} calendar{savedPlans.length === 1 ? '' : 's'} for {monthLabel}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {savedPlans.map((plan) => (
                        <div
                          key={plan.id}
                          className="rounded-2xl border border-brand-500/25 bg-brand-500/5 p-4 animate-fade-in"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <Clock size={18} className="mt-0.5 shrink-0 text-brand-600" />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{plan.name}</p>
                                <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                                  {plan.entries.length} ideas ·{' '}
                                  {plan.executionMode === 'manual'
                                    ? 'calendar only — generate when chosen'
                                    : `automatic at ${plan.runTime} (${plan.timezone})`}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                  {(['manual', 'pending', 'generating', 'ready', 'failed', 'skipped'] as const).map(
                                    (st) => {
                                      const count = plan.entries.filter((e) => e.status === st).length;
                                      return count ? (
                                        <span
                                          key={st}
                                          className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-0.5 font-medium capitalize"
                                        >
                                          {st}: {count}
                                        </span>
                                      ) : null;
                                    },
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn-secondary btn-sm inline-flex shrink-0 items-center gap-1.5 text-red-600"
                              onClick={() => void deleteSavedPlan(plan)}
                              disabled={deletingPlanId === plan.id}
                              aria-label={`Delete ${plan.name}`}
                            >
                              <Trash2 size={14} />
                              {deletingPlanId === plan.id ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="helper-text">
                      Upload another file above to add another calendar for the same month.
                    </p>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="panel cal-surface-festival animate-stage-in">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker text-amber-800 dark:text-amber-200">Universal · Filters</p>
                  <p className="panel-title">Markets & moment types</p>
                </div>
              </div>
              <div className="panel-body space-y-4">
                <div>
                  <p className="field-label">Markets</p>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(REGION_LABEL) as RegionId[]).map((id) => {
                      const on = regions.includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleRegion(id)}
                          className={`status-badge border transition-all duration-200 ${
                            on
                              ? `${REGION_COLOR[id]} shadow-sm`
                              : 'status-badge-muted opacity-55 hover:opacity-90'
                          }`}
                        >
                          {REGION_LABEL[id]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="field-label">Moment types</p>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(CATEGORY_LABEL) as CategoryId[]).map((id) => {
                      const on = categories.includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleCategory(id)}
                          className={`status-badge border transition-all duration-200 ${
                            on
                              ? 'border-brand-500/40 bg-brand-500/10 text-brand-700 shadow-sm dark:text-brand-300'
                              : 'status-badge-muted opacity-55 hover:opacity-90'
                          }`}
                        >
                          {CATEGORY_LABEL[id]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {!loading && events.length === 0 && (
                  <InlineNotice kind="info">
                    No festivals match these filters for {monthLabel}. Turn on more Markets
                    (e.g. India, Global) or Moment types, or switch month — Europe often has
                    fewer September festivals than India/GCC.
                  </InlineNotice>
                )}
              </div>
            </section>
          )}

          <section
            className={`panel overflow-hidden ${
              customPlanMode ? 'cal-surface-plan' : 'cal-surface-festival'
            }`}
          >
            <div className="panel-header">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 shadow-sm">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => shiftMonth(-1)}
                    aria-label="Previous month"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div className="min-w-[9.5rem] max-w-[14rem] px-1 text-center sm:max-w-[18rem]">
                    <p className="panel-kicker !mb-0 whitespace-normal">
                      {customPlanMode ? 'My content month' : 'Festival month'}
                    </p>
                    <p className="panel-title !text-base whitespace-normal break-words leading-snug">
                      {monthLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => shiftMonth(1)}
                    aria-label="Next month"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                    customPlanMode
                      ? 'border-teal-500/30 bg-teal-500/10 text-teal-800 dark:text-teal-200'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100'
                  }`}
                >
                  {customPlanMode ? (
                    <>
                      <FileSpreadsheet size={11} /> Your plan
                    </>
                  ) : (
                    <>
                      <CalendarDays size={11} /> Universal
                    </>
                  )}
                </span>
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  const n = new Date();
                  setYear(n.getFullYear());
                  setMonth(n.getMonth() + 1);
                }}
              >
                Jump to today
              </button>
            </div>

            <div className="panel-body !pt-3">
              {/* Mobile agenda — easier taps than a cramped 7-col grid */}
              <div className="space-y-3 sm:hidden">
                {loading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="skeleton h-16 w-full rounded-xl" />
                    ))}
                  </div>
                ) : agendaDays.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center">
                    <p className="text-sm font-medium">No moments this month</p>
                    <p className="helper-text mt-1">
                      {customPlanMode
                        ? 'Upload a plan to populate this month.'
                        : 'Adjust markets or types, or switch months.'}
                    </p>
                  </div>
                ) : (
                  agendaDays.map(({ day, isToday, events: dayEvents, customs: dayCustoms }) => (
                    <div
                      key={day}
                      className={`rounded-2xl border p-3 ${
                        isToday
                          ? 'border-brand-500/50 bg-brand-500/[0.06]'
                          : 'border-[hsl(var(--border))]'
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">
                          {monthLabel.split(' ')[0]} {day}
                          {isToday ? (
                            <span className="ml-2 text-[11px] font-medium text-brand-600">Today</span>
                          ) : null}
                        </p>
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                          {dayEvents.length + dayCustoms.length} item
                          {dayEvents.length + dayCustoms.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {dayCustoms.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => openEntryPreview(entry)}
                            disabled={generatingEntryId === entry.id}
                            className={`flex min-h-[52px] w-full flex-col justify-center rounded-xl border-l-4 border px-3 py-2.5 text-left transition active:scale-[0.99] ${
                              !entry.planId && selectedPlanIds.includes(entry.id)
                                ? 'border-l-teal-600 border-teal-500/45 bg-teal-500/15'
                                : 'border-l-teal-500 border-teal-500/25 bg-teal-500/[0.08]'
                            }`}
                          >
                            <span className="text-[10px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">
                              My plan
                            </span>
                            <span className="text-sm font-semibold leading-snug">{entry.title}</span>
                            {carouselChipLabel(entry) ? (
                              <span className="mt-0.5 inline-flex w-fit rounded-md border border-teal-600/30 bg-teal-600/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-200">
                                {carouselChipLabel(entry)}
                              </span>
                            ) : null}
                            {entry.planId ? (
                              <span className="mt-0.5 text-[11px] capitalize text-teal-700 dark:text-teal-300">
                                {generatingEntryId === entry.id
                                  ? 'Starting…'
                                  : entry.status === 'manual'
                                    ? 'Calendar only · tap to generate'
                                    : entry.status === 'failed'
                                      ? 'Aborted or deleted · tap to regenerate'
                                      : entry.status === 'ready'
                                      ? 'Ready · open in Approvals'
                                      : entry.status}
                              </span>
                            ) : null}
                            {entry.theme ? (
                              <span className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                                {entry.theme}
                              </span>
                            ) : null}
                          </button>
                        ))}
                        {dayEvents.map((ev) => (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => openEvent(ev)}
                            className={`flex min-h-[52px] w-full flex-col justify-center rounded-xl border-l-4 border-l-amber-500 border px-3 py-2.5 text-left transition active:scale-[0.99] ${REGION_COLOR[ev.region]}`}
                          >
                            <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">
                              Festival · {CATEGORY_LABEL[ev.category]}
                            </span>
                            <span className="text-sm font-semibold leading-snug">{ev.name}</span>
                            <span className="mt-0.5 text-[11px] opacity-80">
                              {REGION_LABEL[ev.region]}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Tablet / desktop month grid */}
              <div className="hidden sm:block">
                <div className="mb-2 grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <div key={d} className="py-1">
                      {d}
                    </div>
                  ))}
                </div>

                {loading ? (
                  <div className="grid grid-cols-7 gap-1.5">
                    {Array.from({ length: 28 }).map((_, i) => (
                      <div key={i} className="skeleton min-h-[76px] rounded-xl sm:min-h-[104px]" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-1.5">
                    {cells.map((day, idx) => {
                      if (day == null) {
                        return (
                          <div
                            key={`e-${idx}`}
                            className="min-h-[76px] rounded-xl bg-[hsl(var(--muted)/0.28)] sm:min-h-[104px]"
                          />
                        );
                      }
                      const dayEvents = customPlanMode ? [] : eventsByDay.get(day) || [];
                      const dayCustoms = customPlanMode ? customByDay.get(day) || [] : [];
                      const isToday =
                        day === now.getDate() &&
                        month === now.getMonth() + 1 &&
                        year === now.getFullYear();
                      return (
                        <div
                          key={day}
                          className={`cal-day ${
                            isToday
                              ? 'cal-day-today'
                              : 'border-[hsl(var(--border))] bg-[hsl(var(--background))]'
                          }`}
                        >
                          <div
                            className={`mb-1.5 text-[11px] font-bold tabular-nums ${
                              isToday ? 'text-brand-700 dark:text-brand-300' : ''
                            }`}
                          >
                            {day}
                          </div>
                          <div className="space-y-1">
                            {dayCustoms.slice(0, 4).map((entry) => (
                              <button
                                key={entry.id}
                                type="button"
                                onClick={() => openEntryPreview(entry)}
                                disabled={generatingEntryId === entry.id}
                                className={`cal-event-chip cal-chip-plan ${
                                  !entry.planId && selectedPlanIds.includes(entry.id)
                                    ? 'cal-chip-plan-on'
                                    : ''
                                }`}
                                title={
                                  entry.status === 'failed'
                                    ? `${entry.title} — aborted or deleted. Click to view full title`
                                    : entry.executionMode === 'manual' && entry.status === 'manual'
                                      ? `${entry.title} — click to view full title`
                                      : `My plan · ${entry.title}`
                                }
                              >
                                {carouselChipLabel(entry) ? (
                                  <span className="mb-0.5 block text-[9px] font-bold uppercase tracking-wide opacity-80">
                                    {carouselChipLabel(entry)}
                                  </span>
                                ) : null}
                                <span className="cal-event-chip-title">{entry.title}</span>
                              </button>
                            ))}
                            {dayCustoms.length > 4 && (
                              <button
                                type="button"
                                className="min-h-[28px] text-[10px] font-semibold text-teal-700 transition hover:underline dark:text-teal-300"
                                onClick={() =>
                                  setDayDrawer({ day, items: [], customs: dayCustoms })
                                }
                              >
                                +{dayCustoms.length - 4} more
                              </button>
                            )}
                            {dayEvents.slice(0, 4).map((ev) => (
                              <button
                                key={ev.id}
                                type="button"
                                onClick={() => openEvent(ev)}
                                className={`cal-event-chip cal-chip-festival ${REGION_COLOR[ev.region]}`}
                                title={`Festival · ${ev.name} · ${CATEGORY_LABEL[ev.category]}`}
                              >
                                <span className="cal-event-chip-title">{ev.name}</span>
                              </button>
                            ))}
                            {!customPlanMode && dayEvents.length > 4 && (
                              <button
                                type="button"
                                className="min-h-[28px] text-[10px] font-semibold text-brand-600 transition hover:underline"
                                onClick={() => setDayDrawer({ day, items: dayEvents })}
                              >
                                +{dayEvents.length - 4} more
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>

          {!customPlanMode && <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Recent activity</p>
                <p className="panel-title">Calendar drafts</p>
              </div>
              {scheduledPosts.length > 0 && (
                <Link href="/approvals" className="btn-secondary btn-sm">
                  Open Approvals
                </Link>
              )}
            </div>
            <div className="panel-body">
              {scheduledPosts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-10 text-center">
                  <CalendarDays
                    size={28}
                    className="mx-auto mb-3 text-[hsl(var(--muted-foreground))] opacity-60"
                  />
                  <p className="text-sm font-medium">No calendar drafts yet</p>
                  <p className="helper-text mx-auto mt-1 max-w-sm">
                    Pick a moment on the grid, or upload a custom plan, to create posts for review.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {scheduledPosts.slice(0, 12).map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] px-3.5 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-500/30 hover:shadow-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {p.headline || 'Preparing draft…'}
                        </p>
                        <p className="mt-0.5 text-[11px] capitalize text-[hsl(var(--muted-foreground))]">
                          {p.status.replace(/_/g, ' ')}
                          {p.scheduledAt ? ` · ${new Date(p.scheduledAt).toLocaleString()}` : ''}
                          {p.targetPlatforms?.length ? ` · ${p.targetPlatforms.join(', ')}` : ''}
                        </p>
                      </div>
                      <Link href={`/approvals/${p.id}`} className="btn-secondary btn-sm shrink-0">
                        Review
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>}
        </div>
      </div>

      {dayDrawer && (
        <div
          className="cal-modal-backdrop z-[75]"
          role="dialog"
          aria-modal="true"
          onClick={() => setDayDrawer(null)}
        >
          <div
            className="panel cal-modal-sheet w-full max-w-md animate-scale-in shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Day view</p>
                <p className="panel-title">
                  {monthLabel} {dayDrawer.day}
                </p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setDayDrawer(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="panel-body max-h-[60vh] space-y-2 overflow-y-auto">
              {(dayDrawer.customs?.length || 0) + dayDrawer.items.length > 0 ? (
                <p className="helper-text mb-1">
                  {(dayDrawer.customs?.length || 0) + dayDrawer.items.length} item
                  {(dayDrawer.customs?.length || 0) + dayDrawer.items.length === 1 ? '' : 's'} — choose
                  one to view
                </p>
              ) : null}
              {(dayDrawer.customs || []).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="flex min-h-[56px] w-full flex-col gap-0.5 rounded-xl border border-teal-500/30 bg-teal-500/[0.06] px-3.5 py-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-500/50 hover:shadow-sm active:scale-[0.99]"
                  onClick={() => {
                    setDayDrawer(null);
                    openEntryPreview(entry);
                  }}
                >
                  <span className="text-sm font-semibold leading-snug whitespace-normal break-words">
                    {entry.title}
                  </span>
                  {entry.theme ? (
                    <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                      {entry.theme}
                    </span>
                  ) : null}
                </button>
              ))}
              {dayDrawer.items.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className="flex min-h-[56px] w-full flex-col gap-0.5 rounded-xl border border-[hsl(var(--border))] px-3.5 py-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-500/40 hover:bg-[hsl(var(--muted)/0.35)] hover:shadow-sm active:scale-[0.99]"
                  onClick={() => {
                    setDayDrawer(null);
                    openEvent(ev);
                  }}
                >
                  <span className="text-sm font-semibold leading-snug whitespace-normal break-words">
                    {ev.name}
                  </span>
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    {REGION_LABEL[ev.region]} · {CATEGORY_LABEL[ev.category]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {entryPreview && (
        <div
          className="cal-modal-backdrop z-[80]"
          role="dialog"
          aria-modal="true"
          onClick={() => setEntryPreview(null)}
        >
          <div
            className="panel cal-modal-sheet w-full max-w-lg animate-scale-in shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <div className="min-w-0">
                <p className="panel-kicker">Plan entry</p>
                <p className="panel-title whitespace-normal break-words leading-snug">
                  {entryPreview.title}
                </p>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                  {entryPreview.date}
                </p>
              </div>
              <button
                type="button"
                className="icon-btn shrink-0"
                onClick={() => setEntryPreview(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="panel-body space-y-3">
              {entryPreview.theme ? (
                <div>
                  <p className="field-label">Theme</p>
                  <p className="text-sm leading-relaxed whitespace-normal break-words">
                    {entryPreview.theme}
                  </p>
                </div>
              ) : null}
              {entryPreview.notes ? (
                <div>
                  <p className="field-label">Notes</p>
                  <p className="text-sm leading-relaxed whitespace-normal break-words text-[hsl(var(--muted-foreground))]">
                    {entryPreview.notes}
                  </p>
                </div>
              ) : null}
              {entryPreview.hashtags?.length ? (
                <div>
                  <p className="field-label">Hashtags</p>
                  <p className="text-sm leading-relaxed whitespace-normal break-words">
                    {entryPreview.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
                  </p>
                </div>
              ) : null}
              {carouselChipLabel(entryPreview) ? (
                <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">
                  {carouselChipLabel(entryPreview)}
                </p>
              ) : null}
              {entryPreview.status ? (
                <p className="text-[11px] capitalize text-[hsl(var(--muted-foreground))]">
                  Status · {entryPreview.status.replace(/_/g, ' ')}
                </p>
              ) : null}

              {entryPreview.planId && canRegenerateEntry(entryPreview) ? (
                <div className="space-y-2 border-t border-[hsl(var(--border))] pt-3">
                  <CreativeModePicker
                    value={entryVisualMode}
                    onChange={setEntryVisualMode}
                    brandTemplatesCount={brandTemplates.length}
                  />
                  {entryVisualMode === 'existing_template' && brandTemplates.length > 0 ? (
                    <select
                      className="input text-sm"
                      value={entryBrandTemplateId}
                      onChange={(e) => setEntryBrandTemplateId(e.target.value)}
                    >
                      {brandTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.provider === 'placid' ? ' · Imported' : ' · In-house'}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setEntryPreview(null)}
                >
                  Close
                </button>
                {!entryPreview.planId ||
                (entryPreview.status === 'ready' && entryPreview.contentId) ||
                canRegenerateEntry(entryPreview) ? (
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={
                      generatingEntryId === entryPreview.id ||
                      (Boolean(entryPreview.planId) &&
                        canRegenerateEntry(entryPreview) &&
                        (!entryVisualMode ||
                          (entryVisualMode === 'existing_template' && !entryBrandTemplateId)))
                    }
                    onClick={() => {
                      void openCustomEntry(entryPreview);
                    }}
                  >
                    {generatingEntryId === entryPreview.id
                      ? 'Starting…'
                      : !entryPreview.planId
                        ? selectedPlanIds.includes(entryPreview.id)
                          ? 'Deselect'
                          : 'Select'
                        : entryPreview.status === 'ready' && entryPreview.contentId
                          ? 'Open in Approvals'
                          : entryPreview.status === 'failed'
                            ? 'Regenerate'
                            : 'Generate'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div
          className="cal-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelected(null)}
        >
          <div
            className="panel cal-modal-sheet flex w-full max-w-lg flex-col animate-scale-in shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header shrink-0">
              <div className="min-w-0">
                <p className={`status-badge border mb-1.5 ${REGION_COLOR[selected.region]}`}>
                  {REGION_LABEL[selected.region]} · {CATEGORY_LABEL[selected.category]}
                </p>
                <p className="panel-title whitespace-normal break-words leading-snug">{selected.name}</p>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{selected.date}</p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSelected(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="panel-body min-h-0 flex-1 space-y-4 overflow-y-auto">
              <p className="text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                {selected.description}
              </p>

              <div>
                <p className="field-label">When</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    className={`cal-choice ${mode === 'now' ? 'cal-choice-on' : 'cal-choice-off'}`}
                    onClick={() => setMode('now')}
                  >
                    <Sparkles size={14} className="mb-1 text-brand-600" />
                    <span className="block text-sm font-semibold">Generate now</span>
                    <span className="mt-1 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">
                      Create a draft right away
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`cal-choice ${mode === 'scheduled' ? 'cal-choice-on' : 'cal-choice-off'}`}
                    onClick={() => setMode('scheduled')}
                  >
                    <Clock size={14} className="mb-1 text-brand-600" />
                    <span className="block text-sm font-semibold">Schedule</span>
                    <span className="mt-1 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">
                      Publish at a set time
                    </span>
                  </button>
                </div>
              </div>

              {mode === 'now' && (
                <div className="space-y-2">
                  <p className="field-label">After generate</p>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[hsl(var(--border))] px-3 py-2.5 text-sm transition hover:bg-[hsl(var(--muted)/0.35)]">
                    <input
                      type="radio"
                      name="publishMode"
                      className="mt-0.5"
                      checked={publishMode === 'review'}
                      onChange={() => setPublishMode('review')}
                    />
                    <span>
                      <span className="font-medium">Send to Approvals</span>
                      <span className="mt-0.5 block text-[11px] text-[hsl(var(--muted-foreground))]">
                        Review and edit before posting
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[hsl(var(--border))] px-3 py-2.5 text-sm transition hover:bg-[hsl(var(--muted)/0.35)]">
                    <input
                      type="radio"
                      name="publishMode"
                      className="mt-0.5"
                      checked={publishMode === 'publish'}
                      onChange={() => setPublishMode('publish')}
                    />
                    <span>
                      <span className="font-medium">Publish immediately</span>
                      <span className="mt-0.5 block text-[11px] text-[hsl(var(--muted-foreground))]">
                        Post to selected channels after generation
                      </span>
                    </span>
                  </label>
                </div>
              )}

              {mode === 'scheduled' && (
                <label className="block space-y-1.5">
                  <span className="field-label">Publish at</span>
                  <input
                    type="datetime-local"
                    className="input"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </label>
              )}

              <div className="space-y-2">
                <CreativeModePicker
                  value={visualMode}
                  onChange={setVisualMode}
                  brandTemplatesCount={brandTemplates.length}
                />
                {visualMode === 'existing_template' && brandTemplates.length > 0 && (
                  <select
                    className="input text-sm"
                    value={brandTemplateId}
                    onChange={(e) => setBrandTemplateId(e.target.value)}
                  >
                    {brandTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.provider === 'placid' ? ' · Imported' : ' · In-house'}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-2">
                <p className="field-label">
                  Channels
                  {!needsChannels ? (
                    <span className="ml-1 font-normal text-[hsl(var(--muted-foreground))]">
                      optional for review
                    </span>
                  ) : null}
                </p>
                {platforms.length === 0 ? (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {needsChannels ? (
                      <>
                        No connected channels.{' '}
                        <Link href="/settings" className="underline">
                          Settings → Publish
                        </Link>
                      </>
                    ) : (
                      <>
                        No channels yet — fine for review. Connect later in{' '}
                        <Link href="/settings" className="underline">
                          Settings → Publish
                        </Link>
                        .
                      </>
                    )}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {platforms.map((c) => {
                      const on = selectedPlatforms.includes(c.platform);
                      return (
                        <label
                          key={c.id}
                          className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition ${
                            on
                              ? 'border-brand-500/40 bg-brand-500/10 text-brand-800 dark:text-brand-200'
                              : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="accent-brand-600"
                            checked={on}
                            onChange={(e) => {
                              setSelectedPlatforms((prev) =>
                                e.target.checked
                                  ? [...new Set([...prev, c.platform])]
                                  : prev.filter((p) => p !== c.platform),
                              );
                            }}
                          />
                          <span className="inline-flex items-center gap-1.5">
                            <PlatformBadge platform={c.platform} size="sm" />
                            <span className="opacity-80">{c.accountName}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="shrink-0 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 pb-[max(0.75rem,calc(4.75rem+env(safe-area-inset-bottom,0px)))] md:pb-3">
              <ProcessingButton
                className="w-full"
                loading={submitting}
                loadingText={mode === 'scheduled' ? 'Scheduling…' : 'Creating draft…'}
                icon={<Sparkles size={14} />}
                disabled={!canSubmit}
                onClick={() => {
                  if (!canSubmit) {
                    if (!visualMode) {
                      notifyError('Choose a creative mode first (AI photo + LLM layout, etc.).');
                      return;
                    }
                    if (visualMode === 'existing_template' && !brandTemplateId) {
                      notifyError('Pick a Brand Studio template.');
                      return;
                    }
                    if (needsChannels && !selectedPlatforms.length) {
                      notifyError('Select at least one connected channel.');
                      return;
                    }
                    return;
                  }
                  void submitGenerate();
                }}
              >
                {mode === 'scheduled'
                  ? 'Schedule this post'
                  : publishMode === 'publish'
                    ? 'Generate & publish'
                    : 'Generate for Approvals'}
              </ProcessingButton>
            </div>
          </div>
        </div>
      )}
      <CalendarAiWizard
        open={aiWizardOpen}
        year={year}
        month={month}
        timezones={planTimezoneOptions}
        defaultTimezone={planTimezone}
        defaultRunTime={planRunTime}
        onClose={() => {
          if (!savingPlan) setAiWizardOpen(false);
        }}
        onComplete={(payload) => void saveAiWizardPlan(payload)}
      />
      <ProcessOverlay
        open={submitting || savingPlan}
        title={savingPlan ? 'Saving month plan' : 'Creating calendar post'}
        description={
          savingPlan
            ? 'Locking in dates, start time, and timezone…'
            : 'Writing caption and image — you can abort anytime.'
        }
        onCancel={savingPlan ? undefined : () => void cancelGenerate()}
        cancelLabel="Abort"
      />
    </AuthGuard>
  );
}

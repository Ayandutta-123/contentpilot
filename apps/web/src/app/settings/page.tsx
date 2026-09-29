'use client';

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthGuard } from '@/components/auth-guard';
import { PasswordInput } from '@/components/password-input';
import { api, apiUpload, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  Trash2, RotateCcw, Plus, Check, Building2, KeyRound,
  Image as ImageIcon, Globe2, Radar, Bell, Upload, Share2, CheckCircle2, LayoutTemplate,
  Workflow, ChevronLeft, ChevronRight, Clock, Mail, Palette, Lock, FileSpreadsheet, Sparkles,
  ExternalLink,
} from 'lucide-react';
import { InlineNotice, ProcessingButton, Spinner, Toggle, WorkflowStepper } from '@/components/ui';
import { PlatformBadge, PlatformBadgeList } from '@/components/platform-badge';
import { notifyError, notifySuccess, toast, withSaveFeedback } from '@/lib/toast';
import { normalizeTargetCountries } from '@/lib/market-countries';
import { MarketCountriesPicker } from '@/components/market-countries-picker';

function scrapePromptDoneKey(tenantId: string) {
  return `cp:scrapePromptDone:${tenantId}`;
}

type Tab = 'profile' | 'integrations' | 'topics' | 'competitors' | 'platforms' | 'automation';

const TABS: { id: Tab; label: string; icon: typeof Building2; hint: string }[] = [
  { id: 'profile', label: 'Company', icon: Building2, hint: 'Brand & kit' },
  { id: 'integrations', label: 'Integrations', icon: KeyRound, hint: 'Shared keys' },
  { id: 'topics', label: 'Topics', icon: Globe2, hint: 'Trend keywords' },
  { id: 'competitors', label: 'Competitors', icon: Radar, hint: 'Watch list' },
  { id: 'platforms', label: 'Publish', icon: Share2, hint: 'Social accounts' },
  { id: 'automation', label: 'Automation', icon: Workflow, hint: 'Schedules' },
];

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="page-container !max-w-5xl animate-fade-in">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading settings…</p>
        </div>
      }
    >
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const initialTab: Tab =
    tabFromUrl && TABS.some((t) => t.id === tabFromUrl) ? (tabFromUrl as Tab) : 'profile';
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const next = searchParams.get('tab');
    if (next && TABS.some((t) => t.id === next)) {
      setTab(next as Tab);
    }
  }, [searchParams]);

  return (
    <AuthGuard>
      <div className="page-container !max-w-5xl animate-fade-in">
        <header className="page-header">
          <div>
            <h1 className="page-title text-slate-900 dark:text-slate-50">Settings</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {user?.companyName || user?.tenantName
                ? `Editing ${user.companyName || user.tenantName} — Integrations & password are shared across all companies.`
                : 'Organization configuration — navy actions, clear sections, professional B2B layout.'}
            </p>
          </div>
        </header>

        <nav
          className="sticky top-[60px] z-30 -mx-3 flex gap-2 overflow-x-auto border-y border-slate-200 bg-white/95 px-3 py-3 scrollbar-none backdrop-blur-md sm:top-[69px] sm:mx-0 sm:rounded-2xl sm:border dark:border-slate-700 dark:bg-slate-950/95"
          role="tablist"
          aria-label="Settings sections"
        >
          {TABS.map(({ id, label, icon: Icon, hint }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                role="tab"
                aria-selected={active}
                data-active={active}
                className="settings-tab"
              >
                <Icon size={16} strokeWidth={2.25} />
                <span className="flex flex-col items-start leading-tight text-left">
                  <span className="tracking-tight">{label}</span>
                  <span
                    className={`text-[10px] font-medium ${
                      active ? 'text-white/75' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {hint}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div key={`${tab}-${user?.tenantId || 'none'}`} className="settings-sector mt-4 space-y-4 animate-fade-in">
          {tab === 'profile' && (
            <Suspense
              fallback={
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-sm text-[hsl(var(--muted-foreground))]">
                  Loading company profile…
                </div>
              }
            >
              <ProfileSettings />
            </Suspense>
          )}
          {tab === 'integrations' && <IntegrationsSettings />}
          {tab === 'topics' && <TopicsSettings />}
          {tab === 'competitors' && <CompetitorsSettings />}
          {tab === 'platforms' && <PlatformSettings />}
          {tab === 'automation' && <AutomationSettings />}
        </div>
      </div>
    </AuthGuard>
  );
}

function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
        ok
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
      }`}
    >
      <span className={`size-1.5 rounded-full ${ok ? 'bg-sky-400' : 'bg-slate-400'}`} />
      {ok ? 'Saved' : 'Not saved'}
    </span>
  );
}

function SectionSaveBar({
  saving,
  result,
  onSave,
  label = 'Save',
}: {
  saving: boolean;
  result: 'ok' | 'err' | null;
  onSave: () => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
      <p
        className={`text-xs min-h-[18px] font-medium ${
          result === 'ok'
            ? 'text-slate-700 dark:text-slate-200'
            : result === 'err'
              ? 'text-slate-900 dark:text-white'
              : 'text-transparent'
        }`}
        aria-live="polite"
      >
        {result === 'ok' ? 'Saved successfully' : result === 'err' ? 'Save failed — try again' : '·'}
      </p>
      <ProcessingButton
        className="!min-h-[48px] !px-6 text-sm tracking-tight"
        loading={saving}
        loadingText="Saving…"
        variant="sector"
        icon={result === 'ok' ? <Check size={15} /> : undefined}
        onClick={onSave}
      >
        {result === 'ok' ? 'Saved' : label}
      </ProcessingButton>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof KeyRound;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-card space-y-4">
      <div className="flex items-start gap-3 pl-1">
        <div className="settings-card-icon mt-0.5">
          <Icon size={18} strokeWidth={2.25} />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-[15px] leading-tight tracking-tight text-slate-900 dark:text-slate-50">
            {title}
          </h3>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="pl-1">{children}</div>
    </section>
  );
}

function ChoiceCards<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className={`grid gap-2 ${
      options.length === 2 ? 'grid-cols-1 sm:grid-cols-2'
        : options.length === 3 ? 'grid-cols-1 sm:grid-cols-3'
          : 'grid-cols-1 sm:grid-cols-2'
    }`}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={`relative text-left rounded-xl border px-3.5 py-3.5 min-h-[56px] transition-all active:scale-[0.98] ${
              active
                ? 'border-slate-900 bg-slate-900 text-white shadow-md shadow-slate-900/20 dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold tracking-tight">{opt.label}</span>
              {active && <CheckCircle2 size={18} className="shrink-0 text-sky-400 dark:text-sky-600" />}
            </div>
            {opt.hint && (
              <p
                className={`mt-0.5 text-[11px] ${
                  active ? 'text-slate-300 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {opt.hint}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Field({
  label,
  status,
  children,
}: {
  label: string;
  status?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="label !mb-0">{label}</label>
        {typeof status === 'boolean' && <StatusBadge ok={status} />}
      </div>
      {children}
    </div>
  );
}

function CategoryTemplateInstaller() {
  type ExistingTpl = {
    id: string;
    label: string;
    previewUrl?: string;
    playId: string;
  };

  const [category, setCategory] = useState('');
  const [resolved, setResolved] = useState<{
    playId: string;
    label: string;
    shortLabel: string;
    existingCount: number;
    existing: ExistingTpl[];
  } | null>(null);
  const [resolveError, setResolveError] = useState('');
  const [resolving, setResolving] = useState(false);
  const [files, setFiles] = useState<Array<{ file: File; label: string }>>([]);
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [installing, setInstalling] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const resolveCategory = async (raw?: string) => {
    const value = (raw ?? category).trim();
    setResolveError('');
    setSuccessMsg('');
    setResolved(null);
    setFiles([]);
    if (!value) {
      setResolveError('Unknown category — use a valid play id.');
      return;
    }
    setResolving(true);
    try {
      const res = await api<{
        data: {
          playId: string;
          label: string;
          shortLabel: string;
          existingCount: number;
          existing: ExistingTpl[];
        };
      }>(`/brand/poster-templates/resolve-play?category=${encodeURIComponent(value)}`);
      setResolved(res.data);
      setCategory(res.data.playId);
    } catch (e) {
      setResolveError(
        e instanceof Error ? e.message : 'Unknown category — use a valid play id.',
      );
    } finally {
      setResolving(false);
    }
  };

  const onPickFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next = Array.from(list)
      .filter((f) => /^image\/(jpeg|jpg|png|webp)$/i.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name))
      .map((file) => ({
        file,
        label: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || file.name,
      }));
    setFiles((prev) => [...prev, ...next]);
  };

  const install = async () => {
    if (!resolved || !files.length) return;
    setInstalling(true);
    setSuccessMsg('');
    try {
      const fd = new FormData();
      fd.append('category', resolved.playId);
      fd.append('mode', mode);
      for (const item of files) {
        fd.append('files', item.file, item.file.name);
        fd.append('labels', item.label);
      }
      const res = await apiUpload<{
        data: { installed: number; playId: string; message: string; templates: ExistingTpl[] };
      }>('/brand/poster-templates/install', fd);
      setSuccessMsg(res.data.message);
      notifySuccess(res.data.message);
      setFiles([]);
      await resolveCategory(resolved.playId);
      setSuccessMsg(res.data.message);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Install failed');
    } finally {
      setInstalling(false);
    }
  };

  const removeExisting = async (id: string) => {
    try {
      await api(`/brand/poster-templates/uploads/${id}`, { method: 'DELETE' });
      if (resolved) await resolveCategory(resolved.playId);
      notifySuccess('Template removed');
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Could not remove');
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard
        icon={LayoutTemplate}
        title="Install category templates"
        description="Type a play category first (offer, launch, countdown…). Then upload finished poster images — those exact images become the AI Assistant picker for that category."
      >
        <Field label="Category (required first)">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="input flex-1"
              value={category}
              placeholder="e.g. offer | launch | countdown | aesthetic"
              onChange={(e) => {
                setCategory(e.target.value);
                setResolved(null);
                setResolveError('');
                setSuccessMsg('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void resolveCategory();
                }
              }}
            />
            <ProcessingButton
              type="button"
              variant="sector"
              className="!min-h-[44px] shrink-0"
              loading={resolving}
              onClick={() => void resolveCategory()}
            >
              Use category
            </ProcessingButton>
          </div>
          {resolveError && (
            <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-200" role="alert">
              {resolveError}
            </p>
          )}
          {resolved && (
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              Using <span className="font-semibold text-[hsl(var(--foreground))]">{resolved.playId}</span>
              {' — '}
              {resolved.label}
              {resolved.existingCount
                ? ` · ${resolved.existingCount} installed template${resolved.existingCount === 1 ? '' : 's'}`
                : ' · no uploads yet (builtins still show until you install)'}
            </p>
          )}
        </Field>
      </SectionCard>

      {resolved && (
        <>
          {resolved.existing.length > 0 && (
            <SectionCard
              icon={ImageIcon}
              title={`Current templates for ${resolved.playId}`}
              description="These exact images appear in AI Assistant for this category."
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {resolved.existing.map((t) => (
                  <div
                    key={t.id}
                    className="overflow-hidden rounded-xl border border-[hsl(var(--border))]"
                  >
                    <div className="relative aspect-square bg-[hsl(var(--muted))]">
                      {t.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.previewUrl}
                          alt={t.label}
                          className="absolute inset-0 size-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-2 p-2.5">
                      <p className="truncate text-xs font-medium">{t.label}</p>
                      <button
                        type="button"
                        className="btn-ghost min-h-[44px] md:!min-h-8 !px-2 text-xs text-slate-700 dark:text-slate-200"
                        onClick={() => void removeExisting(t.id)}
                        aria-label={`Remove ${t.label}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          <SectionCard
            icon={Upload}
            title="Upload template images"
            description="JPG, PNG, or WebP. Multi-file. Optional labels default to the filename."
          >
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-4 py-10 text-center transition hover:border-brand-500/50">
              <Upload size={22} className="text-brand-600" />
              <span className="text-sm font-medium">Drop or choose finished posters</span>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                Multi-select · JPG / PNG / WebP
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                multiple
                className="sr-only"
                onChange={(e) => {
                  onPickFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>

            {files.length > 0 && (
              <ul className="mt-3 space-y-2">
                {files.map((item, idx) => (
                  <li
                    key={`${item.file.name}-${idx}`}
                    className="flex flex-col gap-2 rounded-xl border border-[hsl(var(--border))] p-3 sm:flex-row sm:items-center"
                  >
                    <p className="min-w-0 flex-1 truncate text-xs text-[hsl(var(--muted-foreground))]">
                      {item.file.name}
                    </p>
                    <input
                      className="input !min-h-10 flex-1 text-sm"
                      value={item.label}
                      onChange={(e) => {
                        const label = e.target.value;
                        setFiles((prev) =>
                          prev.map((f, i) => (i === idx ? { ...f, label } : f)),
                        );
                      }}
                      placeholder="Label"
                    />
                    <button
                      type="button"
                      className="btn-ghost !min-h-10 !px-2"
                      onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Field label="Install mode">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: 'replace' as const, label: 'Replace all for this category' },
                    { id: 'append' as const, label: 'Append to existing' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`chip min-h-[44px] md:!min-h-[40px] transition-all ${
                      mode === opt.id
                        ? '!border-transparent !bg-slate-900 !text-white shadow-md dark:!bg-slate-100 dark:!text-slate-900'
                        : '!border-slate-200 !text-slate-700 dark:!border-slate-600 dark:!text-slate-200'
                    }`}
                    onClick={() => setMode(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </Field>

            <ProcessingButton
              type="button"
              variant="sector"
              className="!min-h-[48px] w-full sm:w-auto !px-6"
              loading={installing}
              disabled={!files.length || installing}
              onClick={() => void install()}
            >
              Install / Replace templates for {resolved.playId}
            </ProcessingButton>

            {successMsg && (
              <InlineNotice kind="success">
                {successMsg}
              </InlineNotice>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

function ProfileSettings() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form, setForm] = useState({
    companyName: '',
    productName: '',
    productTagline: '',
    industry: '',
    websiteUrl: '',
    contactEmail: '',
    instagramUrl: '',
    facebookUrl: '',
    linkedinUrl: '',
    twitterUrl: '',
    brandType: 'b2b' as 'b2b' | 'b2c',
    brandVoice: '',
    imageStyle: '',
    hashtagStrategy: '',
    contentGuidelines: '',
    targetAudience: '',
    targetCountries: ['worldwide'] as string[],
    logoUrl: '' as string | null,
    websiteScrapedAt: null as string | null,
    brandKitMode: 'mix' as 'strict' | 'mix' | 'sometimes' | 'off',
    posterReferenceMode: 'off' as 'off' | 'guide' | 'strong',
    primaryColor: '#0B1F3A',
    secondaryColor: '#1E3A5F',
    accentColor: '#E23A2E',
    backgroundColor: '#0B1220',
    textColor: '#F7F4EE',
    headingFont: 'modern' as 'serif' | 'sans' | 'display' | 'modern',
    bodyFont: 'sans' as 'serif' | 'sans' | 'display' | 'modern',
  });
  const [saved, setSaved] = useState(false);
  const [identityResult, setIdentityResult] = useState<'ok' | 'err' | null>(null);
  const [saving, setSaving] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [colorScraping, setColorScraping] = useState(false);
  const [kitSaving, setKitSaving] = useState(false);
  const [kitResult, setKitResult] = useState<'ok' | 'err' | null>(null);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);
  const [brandLoaded, setBrandLoaded] = useState(false);
  const [showScrapePrompt, setShowScrapePrompt] = useState(false);
  const [scrapePromptUrl, setScrapePromptUrl] = useState('');
  const [welcomeScraping, setWelcomeScraping] = useState(false);
  const [brandAnalysis, setBrandAnalysis] = useState<{
    proposal: Partial<typeof form>;
    sourceUrls: string[];
    pagesScraped: number;
    notice: string;
  } | null>(null);
  const [posterReferences, setPosterReferences] = useState<Array<{
    id: string;
    imageUrl: string;
    label: string;
    styleBrief: string;
    width?: number | null;
    height?: number | null;
  }>>([]);
  const [posterReferencesMax, setPosterReferencesMax] = useState(20);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const posterReferenceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ data: typeof form }>('/settings/brand')
      .then((res) => {
        if (res.data) {
          setForm((f) => ({
            ...f,
            ...res.data,
            brandType: res.data.brandType === 'b2c' ? 'b2c' : 'b2b',
            logoUrl: res.data.logoUrl || '',
            targetCountries: normalizeTargetCountries(
              (res.data as { targetCountries?: string[] }).targetCountries,
            ),
            websiteScrapedAt: (res.data as { websiteScrapedAt?: string | null }).websiteScrapedAt || null,
            brandKitMode:
              res.data.brandKitMode === 'strict' ||
              res.data.brandKitMode === 'mix' ||
              res.data.brandKitMode === 'sometimes' ||
              res.data.brandKitMode === 'off'
                ? res.data.brandKitMode
                : 'mix',
            posterReferenceMode:
              res.data.posterReferenceMode === 'guide' ||
              res.data.posterReferenceMode === 'strong'
                ? res.data.posterReferenceMode
                : 'off',
            primaryColor: res.data.primaryColor || f.primaryColor,
            secondaryColor: res.data.secondaryColor || f.secondaryColor,
            accentColor: res.data.accentColor || f.accentColor,
            backgroundColor: res.data.backgroundColor || f.backgroundColor,
            textColor: res.data.textColor || f.textColor,
            headingFont:
              res.data.headingFont === 'serif' ||
              res.data.headingFont === 'sans' ||
              res.data.headingFont === 'display' ||
              res.data.headingFont === 'modern'
                ? res.data.headingFont
                : f.headingFont,
            bodyFont:
              res.data.bodyFont === 'serif' ||
              res.data.bodyFont === 'sans' ||
              res.data.bodyFont === 'display' ||
              res.data.bodyFont === 'modern'
                ? res.data.bodyFont
                : f.bodyFont,
          }));
          setScrapePromptUrl((res.data.websiteUrl || '').trim());
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setBrandLoaded(true));
  }, []);

  const loadPosterReferences = async () => {
    try {
      const res = await api<{
        data: {
          mode: 'off' | 'guide' | 'strong';
          references: typeof posterReferences;
          max: number;
        };
      }>('/settings/brand/poster-references');
      setPosterReferences(res.data.references || []);
      setPosterReferencesMax(res.data.max || 20);
      setForm((current) => ({ ...current, posterReferenceMode: res.data.mode || 'off' }));
    } catch {
      // Brand settings may not exist yet.
    }
  };

  useEffect(() => {
    void loadPosterReferences();
  }, []);

  // One-time "Scrape now" after creating a company (?scrapePrompt=1)
  useEffect(() => {
    if (!brandLoaded || !user?.tenantId) return;
    const wants = searchParams.get('scrapePrompt') === '1';
    if (!wants) return;
    try {
      if (localStorage.getItem(scrapePromptDoneKey(user.tenantId)) === '1') {
        router.replace('/settings');
        return;
      }
    } catch {
      // ignore storage errors
    }
    setShowScrapePrompt(true);
  }, [brandLoaded, user?.tenantId, searchParams, router]);

  const dismissScrapePrompt = () => {
    if (user?.tenantId) {
      try {
        localStorage.setItem(scrapePromptDoneKey(user.tenantId), '1');
      } catch {
        // ignore
      }
    }
    setShowScrapePrompt(false);
    router.replace('/settings');
  };

  const runWelcomeScrape = async () => {
    const url = scrapePromptUrl.trim();
    if (!url) {
      setError('Add your website URL to scrape brand voice and colours.');
      notifyError('Add a website URL first');
      return;
    }
    setWelcomeScraping(true);
    setError('');
    setOkMsg('');
    try {
      const nextForm = { ...form, websiteUrl: url, brandType: form.brandType || 'b2b' };
      setForm(nextForm);

      // 1) Save + fill brand voice / sector / guidelines (B2B scrape)
      const brandRes = await api<{
        data: typeof form & { websiteScrapedAt?: string | null };
        meta?: { scraped?: boolean; scrapeError?: string; pagesScraped?: number };
      }>('/settings/brand', {
        method: 'PUT',
        body: {
          ...nextForm,
          scrapeWebsite: nextForm.brandType === 'b2b',
        },
      });
      applyBrandData(brandRes.data);

      // 2) Exact CSS colour scrape → save hexes
      const colorRes = await api<{
        data: typeof form;
        meta?: {
          colors?: {
            primary: string;
            secondary: string;
            accent: string;
            background: string;
            text: string;
          };
          colorSource?: string;
        };
      }>('/settings/brand/scrape-colors', {
        method: 'POST',
        body: { websiteUrl: url, save: true },
      });
      applyBrandData(colorRes.data);

      const c = colorRes.meta?.colors;
      setOkMsg(
        brandRes.meta?.scraped
          ? `Brand voice + colours filled${c ? ` (${c.primary} · ${c.accent})` : ''}. Edit anytime below.`
          : `Colours filled${c ? `: ${c.primary} · ${c.accent}` : ''}. Edit voice fields anytime.`,
      );
      notifySuccess('Brand profile autofilled from your website');
      dismissScrapePrompt();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scrape failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setWelcomeScraping(false);
    }
  };

  const applyBrandData = (data: Partial<typeof form> & { websiteScrapedAt?: string | null }) => {
    setForm((f) => ({
      ...f,
      ...data,
      brandType: data.brandType === 'b2c' ? 'b2c' : data.brandType === 'b2b' ? 'b2b' : f.brandType,
      logoUrl: data.logoUrl ?? f.logoUrl,
      targetCountries: data.targetCountries
        ? normalizeTargetCountries(data.targetCountries)
        : f.targetCountries,
      websiteScrapedAt: data.websiteScrapedAt ?? f.websiteScrapedAt,
    }));
  };

  const toggleCountry = (code: string) => {
    setForm((f) => {
      const cur = normalizeTargetCountries(f.targetCountries);
      if (code === 'worldwide') {
        return { ...f, targetCountries: ['worldwide'] };
      }
      const withoutWorld = cur.filter((c) => c !== 'worldwide');
      const next = withoutWorld.includes(code)
        ? withoutWorld.filter((c) => c !== code)
        : [...withoutWorld, code];
      return { ...f, targetCountries: normalizeTargetCountries(next.length ? next : ['worldwide']) };
    });
  };

  const setCountries = (codes: string[]) => {
    setForm((f) => ({ ...f, targetCountries: normalizeTargetCountries(codes) }));
  };

  const save = async (opts?: { scrapeWebsite?: boolean }) => {
    const forceScrape = opts?.scrapeWebsite === true;
    setSaving(true);
    setScraping(forceScrape);
    setError('');
    setOkMsg('');
    setIdentityResult(null);
    try {
      const res = await api<{
        data: typeof form & { websiteScrapedAt?: string | null };
        meta?: {
          scraped?: boolean;
          scrapeError?: string;
          pagesScraped?: number;
          llmProvider?: string;
          llmModel?: string;
          scrapeMethod?: string;
          code?: string;
        };
      }>('/settings/brand', {
        method: 'PUT',
        body: {
          ...form,
          scrapeWebsite: forceScrape,
        },
      });
      applyBrandData(res.data);
      setSaved(true);
      setIdentityResult('ok');
      setTimeout(() => setSaved(false), 2000);
      setTimeout(() => setIdentityResult(null), 2500);
      if (res.meta?.scraped) {
        setOkMsg(
          `Saved. Scraped ${res.meta.pagesScraped ?? ''} page(s). Edit sector / tone / guidelines below. Use Brand kit → Scrape colours for hexes.`,
        );
        notifySuccess('Company saved + website brand profile filled');
      } else if (res.meta?.scrapeError) {
        setError(`Saved company details, but scrape failed: ${res.meta.scrapeError}`);
        if (res.meta.code !== 'PROVIDER_CREDITS') notifyError(res.meta.scrapeError);
      } else {
        notifySuccess('Company details saved');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      setIdentityResult('err');
      notifyError(msg);
    } finally {
      setSaving(false);
      setScraping(false);
    }
  };

  const saveBrandKit = async () => {
    setKitSaving(true);
    setKitResult(null);
    setError('');
    try {
      const res = await api<{ data: typeof form }>('/settings/brand', {
        method: 'PUT',
        body: {
          brandKitMode: form.brandKitMode,
          posterReferenceMode: form.posterReferenceMode,
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
          accentColor: form.accentColor,
          backgroundColor: form.backgroundColor,
          textColor: form.textColor,
          headingFont: form.headingFont,
          bodyFont: form.bodyFont,
          scrapeWebsite: false,
        },
      });
      applyBrandData(res.data);
      setKitResult('ok');
      notifySuccess(
        form.brandKitMode === 'off'
          ? 'Brand kit saved, but mode is Off — posters will not use these colors until you switch to Brand only or Mix.'
          : 'Brand kit saved. New posters and Approvals → reframe will use these colors and fonts.',
      );
      setTimeout(() => setKitResult(null), 3500);
    } catch (e) {
      setKitResult('err');
      const msg = e instanceof Error ? e.message : 'Could not save brand kit';
      setError(msg);
      notifyError(msg);
    } finally {
      setKitSaving(false);
    }
  };

  const analyzeBrand = async () => {
    if (!form.websiteUrl.trim()) {
      setError('Add a website URL first.');
      notifyError('Add a website URL first');
      return;
    }
    setColorScraping(true);
    setError('');
    try {
      const res = await api<{
        data: Partial<typeof form>;
        meta?: {
          sourceUrls?: string[];
          pagesScraped?: number;
          colorSource?: string;
          rolesFromVars?: number;
          colorsDetected?: number;
          notice?: string;
        };
      }>('/settings/brand/analyze', {
        method: 'POST',
        body: { websiteUrl: form.websiteUrl },
      });
      setBrandAnalysis({
        proposal: res.data,
        sourceUrls: res.meta?.sourceUrls || [],
        pagesScraped: res.meta?.pagesScraped || 0,
        notice: res.meta?.notice || 'Review detected values before applying them.',
      });
      notifySuccess('Brand analysis ready to review — nothing was saved');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Brand analysis failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setColorScraping(false);
    }
  };

  const applyBrandAnalysis = () => {
    if (!brandAnalysis) return;
    setForm((current) => ({ ...current, ...brandAnalysis.proposal }));
    setBrandAnalysis(null);
    setOkMsg('Detected Brand DNA applied to this form. Review it, then save Brand Kit and company profile.');
    notifySuccess('Detected values applied for review');
  };

  const uploadPosterReference = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (posterReferences.length >= posterReferencesMax) {
      notifyError(`You can upload up to ${posterReferencesMax} approved posters.`);
      return;
    }
    setReferenceBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiUpload('/settings/brand/poster-references', fd);
      await loadPosterReferences();
      notifySuccess('Poster analyzed and added to your visual DNA');
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Poster analysis failed');
    } finally {
      setReferenceBusy(false);
    }
  };

  const removePosterReference = async (id: string) => {
    setReferenceBusy(true);
    try {
      await api(`/settings/brand/poster-references/${id}`, { method: 'DELETE' });
      await loadPosterReferences();
      notifySuccess('Poster removed from visual DNA');
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Could not remove poster');
    } finally {
      setReferenceBusy(false);
    }
  };

  const rescrape = async () => {
    if (form.brandType !== 'b2b') {
      setError('Switch to B2B to scrape the website for brand guidelines.');
      return;
    }
    if (!form.websiteUrl.trim()) {
      setError('Add a website URL first.');
      return;
    }
    setScraping(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{
        data: typeof form & { websiteScrapedAt?: string | null };
        meta?: {
          pagesScraped?: number;
          llmProvider?: string;
          llmModel?: string;
          scrapeMethod?: string;
        };
      }>('/settings/brand/scrape-website', {
        method: 'POST',
        body: { websiteUrl: form.websiteUrl, overwrite: true },
      });
      applyBrandData(res.data);
      setOkMsg(
        `Updated voice & guidelines from ${res.meta?.pagesScraped ?? ''} page(s). Brand Kit colours were not changed — use Scrape colours for that.`,
      );
      notifySuccess('Brand profile scraped from website');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scrape failed';
      setError(msg);
      if (!(e instanceof ApiError && e.code === 'PROVIDER_CREDITS')) notifyError(msg);
    } finally {
      setScraping(false);
    }
  };

  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    setError('');
    try {
      const { apiUpload } = await import('@/lib/api');
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiUpload<{ data: { logoUrl?: string | null } }>('/settings/brand/logo', fd);
      setForm((f) => ({ ...f, logoUrl: res.data.logoUrl || '' }));
      notifySuccess('Logo saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Logo upload failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setLogoUploading(false);
      e.target.value = '';
    }
  };

  const identity = [
    { key: 'companyName' as const, label: 'Company Name', placeholder: 'Acme Inc.', rows: 1 },
    { key: 'productName' as const, label: 'Product Name', placeholder: 'Acme Cloud', rows: 1 },
    { key: 'productTagline' as const, label: 'Tagline', placeholder: 'Work smarter…', rows: 1 },
    { key: 'websiteUrl' as const, label: 'Website', placeholder: 'https://…', rows: 1 },
  ];

  const contactFields = [
    { key: 'contactEmail' as const, label: 'Contact email', placeholder: 'hello@company.com' },
    { key: 'instagramUrl' as const, label: 'Instagram', placeholder: 'https://instagram.com/…' },
    { key: 'linkedinUrl' as const, label: 'LinkedIn', placeholder: 'https://linkedin.com/company/…' },
    { key: 'facebookUrl' as const, label: 'Facebook', placeholder: 'https://facebook.com/…' },
    { key: 'twitterUrl' as const, label: 'X / Twitter', placeholder: 'https://x.com/…' },
  ];

  const scrapedFields = [
    {
      key: 'industry' as const,
      label: 'Sector / industry',
      placeholder: 'Filled from website for B2B — e.g. Smart parking / PropTech',
      rows: 2,
    },
    {
      key: 'brandVoice' as const,
      label: 'Tone of voice',
      placeholder: 'How the brand speaks — scraped then human-editable',
      rows: 4,
    },
    {
      key: 'contentGuidelines' as const,
      label: 'Brand guidelines',
      placeholder: 'Messaging pillars, claims to use/avoid — scraped then human-editable',
      rows: 5,
    },
    {
      key: 'targetAudience' as const,
      label: 'Target audience',
      placeholder: 'Who you sell to',
      rows: 3,
    },
    {
      key: 'hashtagStrategy' as const,
      label: 'Hashtag strategy',
      placeholder: 'Mix of industry tags…',
      rows: 2,
    },
    {
      key: 'imageStyle' as const,
      label: 'Image style',
      placeholder: 'Clean, minimalist…',
      rows: 2,
    },
  ];

  return (
    <div className="space-y-4 pb-24">
      {showScrapePrompt && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/50 p-4 backdrop-blur-[2px] sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-scrape-title"
        >
          <div className="w-full max-w-md rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-2xl animate-scale-in">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-600/15 text-brand-700 dark:text-brand-300">
                <Sparkles size={22} />
              </div>
              <div className="min-w-0 pt-0.5">
                <p id="welcome-scrape-title" className="text-base font-semibold">
                  Scrape your brand now?
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                  We’ll pull brand voice, sector, guidelines, and exact colour codes from your
                  website. One-time prompt — you can skip and scrape later from Identity / Brand kit.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-medium text-[hsl(var(--muted-foreground))]">
                Website URL
              </label>
              <input
                className="input"
                value={scrapePromptUrl}
                onChange={(e) => setScrapePromptUrl(e.target.value)}
                placeholder="https://yourcompany.com"
                autoFocus
                disabled={welcomeScraping}
              />
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn-ghost min-h-[44px] px-4"
                disabled={welcomeScraping}
                onClick={dismissScrapePrompt}
              >
                Not now
              </button>
              <ProcessingButton
                className="!min-h-[44px] !px-5"
                loading={welcomeScraping}
                loadingText="Scraping…"
                disabled={!scrapePromptUrl.trim()}
                onClick={() => void runWelcomeScrape()}
              >
                Scrape now
              </ProcessingButton>
            </div>
          </div>
        </div>
      )}

      <SectionCard
        icon={Building2}
        title="Identity"
        description="Shown in generated content context — never hardcoded in the product."
      >
        <Field label="Brand type">
          <ChoiceCards
            value={form.brandType}
            onChange={(id) => setForm({ ...form, brandType: id })}
            options={[
              {
                id: 'b2b',
                label: 'B2B',
                hint: 'Saving a website scrapes sector, tone & guidelines for editing',
              },
              {
                id: 'b2c',
                label: 'B2C',
                hint: 'Consumer brand — fill voice fields manually (no auto-scrape)',
              },
            ]}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {identity.map(({ key, label, placeholder, rows }) => (
            <Field key={key} label={label}>
              <textarea
                className="input min-h-[44px] resize-y"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                placeholder={placeholder}
                rows={rows}
              />
            </Field>
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Carousel CTA contacts</p>
          <p className="helper-text">
            Only filled fields appear on the last carousel slide. Scraped from your website when
            available — edit anytime.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {contactFields.map(({ key, label, placeholder }) => (
              <Field key={key} label={label}>
                <input
                  className="input"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  placeholder={placeholder}
                />
              </Field>
            ))}
          </div>
        </div>
        <Field label="Company logo (on social images)">
          <div className="flex flex-wrap items-center gap-3">
            {form.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.logoUrl}
                alt="Logo"
                className="h-14 w-14 rounded-lg object-contain border border-[hsl(var(--border))] bg-white"
              />
            ) : (
              <div className="h-14 w-14 rounded-lg border border-dashed border-[hsl(var(--border))]" />
            )}
            <label
              className={`btn-sector-outline cursor-pointer !min-h-[44px] ${logoUploading ? 'pointer-events-none opacity-60' : ''}`}
            >
              {logoUploading ? <Spinner size={15} /> : <Upload size={15} />}
              {logoUploading ? 'Uploading…' : 'Upload logo'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={logoUploading}
                onChange={uploadLogo}
              />
            </label>
          </div>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
            PNG/SVG preferred. Stamped on the bottom bar of generated social images.
          </p>
        </Field>
        <SectionSaveBar
          label="Save identity"
          saving={saving && !scraping}
          result={identityResult}
          onSave={() => void save()}
        />
      </SectionCard>

      <SectionCard
        icon={Palette}
        title="Brand kit"
        description="Analyze your website and approved social creatives, review the findings, then decide what AI may reuse."
      >
        <div className="flex flex-wrap gap-2">
          <ProcessingButton
            type="button"
            variant="sector"
            className="!min-h-[48px] !px-5 text-sm"
            loading={colorScraping}
            loadingText="Analyzing brand…"
            icon={<Sparkles size={15} />}
            onClick={() => void analyzeBrand()}
            disabled={!form.websiteUrl.trim() || colorScraping || kitSaving}
          >
            Analyze website
          </ProcessingButton>
          <p className="flex w-full text-xs text-[hsl(var(--muted-foreground))] sm:w-auto sm:flex-1 sm:items-center">
            Reviews key pages, brand voice, image direction and CSS colours. Nothing is saved automatically.
          </p>
        </div>
        {brandAnalysis && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-4 dark:border-blue-900 dark:bg-blue-950/30">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold text-blue-950 dark:text-blue-100">Brand DNA ready to review</p>
                <p className="mt-1 text-xs text-blue-800 dark:text-blue-200">
                  {brandAnalysis.pagesScraped} page(s) analyzed. {brandAnalysis.notice}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => setBrandAnalysis(null)}>
                  Discard
                </button>
                <button type="button" className="btn-primary" onClick={applyBrandAnalysis}>
                  Apply to form
                </button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                ['Primary', brandAnalysis.proposal.primaryColor],
                ['Secondary', brandAnalysis.proposal.secondaryColor],
                ['Accent', brandAnalysis.proposal.accentColor],
                ['Background', brandAnalysis.proposal.backgroundColor],
                ['Text', brandAnalysis.proposal.textColor],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-blue-100 bg-white p-2 dark:border-blue-900 dark:bg-slate-950">
                  <div className="mb-2 h-8 rounded-lg border" style={{ background: String(value || '#ffffff') }} />
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="font-mono text-xs">{String(value || 'Not found')}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        <Field label="How to use these colors & fonts">
          <ChoiceCards
            value={form.brandKitMode}
            onChange={(id) =>
              setForm({
                ...form,
                brandKitMode: id as 'strict' | 'mix' | 'sometimes' | 'off',
              })
            }
            options={[
              {
                id: 'strict',
                label: 'Brand only',
                hint: 'Always use your hexes + fonts — no free palette',
              },
              {
                id: 'mix',
                label: 'Mix & match',
                hint: 'Lead with brand colors, soft neutrals OK',
              },
              {
                id: 'sometimes',
                label: 'Sometimes',
                hint: '~50% of posts use the kit (stable per post)',
              },
              {
                id: 'off',
                label: 'Off',
                hint: 'Ignore kit — parse colors from Image style only',
              },
            ]}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              { key: 'primaryColor' as const, label: 'Primary' },
              { key: 'secondaryColor' as const, label: 'Secondary' },
              { key: 'accentColor' as const, label: 'Accent' },
              { key: 'backgroundColor' as const, label: 'Background / ground' },
              { key: 'textColor' as const, label: 'Text / ink' },
            ] as const
          ).map(({ key, label }) => (
            <Field key={key} label={label}>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-[hsl(var(--border))] bg-transparent p-1"
                  value={/^#[0-9A-Fa-f]{6}$/.test(form[key]) ? form[key] : '#000000'}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value.toUpperCase() })}
                  aria-label={`${label} color picker`}
                />
                <input
                  className="input font-mono text-sm uppercase"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  placeholder="#0B1F3A"
                  maxLength={16}
                />
              </div>
            </Field>
          ))}
        </div>

        <div
          className="mt-1 flex h-14 overflow-hidden rounded-xl border border-[hsl(var(--border))]"
          aria-hidden
        >
          {(
            [
              form.backgroundColor,
              form.primaryColor,
              form.secondaryColor,
              form.accentColor,
              form.textColor,
            ] as string[]
          ).map((c, i) => (
            <div key={i} className="flex-1" style={{ background: c }} title={c} />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Heading font">
            <select
              className="input"
              value={form.headingFont}
              onChange={(e) =>
                setForm({
                  ...form,
                  headingFont: e.target.value as typeof form.headingFont,
                })
              }
            >
              <option value="modern">Modern UI</option>
              <option value="sans">Sans (clean)</option>
              <option value="serif">Serif (editorial)</option>
              <option value="display">Display (bold)</option>
            </select>
          </Field>
          <Field label="Body font">
            <select
              className="input"
              value={form.bodyFont}
              onChange={(e) =>
                setForm({
                  ...form,
                  bodyFont: e.target.value as typeof form.bodyFont,
                })
              }
            >
              <option value="sans">Sans (clean)</option>
              <option value="modern">Modern UI</option>
              <option value="serif">Serif (editorial)</option>
              <option value="display">Display (bold)</option>
            </select>
          </Field>
        </div>

        <div
          className="overflow-hidden rounded-2xl border border-[hsl(var(--border))]"
          style={{ background: form.backgroundColor, color: form.textColor }}
        >
          <div className="h-14" style={{ background: form.secondaryColor }} />
          <div className="space-y-2 p-4">
            <p
              className="text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ color: form.accentColor }}
            >
              Live poster preview
            </p>
            <p
              className="text-lg font-semibold leading-tight"
              style={{
                fontFamily:
                  form.headingFont === 'serif'
                    ? 'Georgia, "Times New Roman", serif'
                    : form.headingFont === 'display'
                      ? 'Impact, Haettenschweiler, sans-serif'
                      : 'ui-sans-serif, system-ui, sans-serif',
              }}
            >
              Headline in your kit
              <span style={{ color: form.accentColor }}> accent</span>
            </p>
            <p
              className="text-xs leading-relaxed opacity-80"
              style={{
                fontFamily:
                  form.bodyFont === 'serif'
                    ? 'Georgia, "Times New Roman", serif'
                    : 'ui-sans-serif, system-ui, sans-serif',
              }}
            >
              Supporting copy, stats and callouts on designed posters pick up these colors and fonts
              after you save.
            </p>
            <span
              className="mt-1 inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide"
              style={{ background: form.accentColor, color: form.backgroundColor }}
            >
              Stat badge
            </span>
          </div>
        </div>

        {form.brandKitMode === 'off' && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Mode is Off — saved colors will not appear on posters until you pick Brand only or Mix &
            match.
          </p>
        )}
        {form.brandKitMode === 'sometimes' && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Mode is Sometimes — only about half of posts use the kit. Choose Brand only if every
            poster must match.
          </p>
        )}

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-slate-50/80 p-4 dark:bg-slate-900/50">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">Approved poster visual DNA</p>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                Add 8–20 strong, previously approved creatives. AI analyzes recurring layout, palette,
                typography and finish. This guides new artwork; it does not train a separate model or
                alter fixed template layers.
              </p>
            </div>
            <div className="shrink-0 text-xs font-semibold text-slate-500">
              {posterReferences.length} / {posterReferencesMax}
            </div>
          </div>

          <div className="mt-4">
            <ChoiceCards
              value={form.posterReferenceMode}
              onChange={(id) =>
                setForm({
                  ...form,
                  posterReferenceMode: id as 'off' | 'guide' | 'strong',
                })
              }
              options={[
                { id: 'off', label: 'Off', hint: 'Do not use poster references' },
                { id: 'guide', label: 'Guide AI', hint: 'Reuse visual traits with fresh layouts' },
                { id: 'strong', label: 'Strong match', hint: 'Aim for the same campaign family' },
              ]}
            />
          </div>

          <input
            ref={posterReferenceInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => void uploadPosterReference(event)}
          />
          <button
            type="button"
            className="btn-secondary mt-4 inline-flex min-h-11 items-center gap-2"
            disabled={referenceBusy || posterReferences.length >= posterReferencesMax}
            onClick={() => posterReferenceInput.current?.click()}
          >
            {referenceBusy ? <Spinner size={16} /> : <Upload size={15} />}
            Add approved poster
          </button>

          {posterReferences.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {posterReferences.map((reference) => (
                <article
                  key={reference.id}
                  className="group relative overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-white dark:bg-slate-950"
                >
                  <img
                    src={reference.imageUrl}
                    alt={reference.label || 'Approved brand poster'}
                    className="aspect-square w-full object-cover"
                  />
                  <div className="p-2">
                    <p className="truncate text-xs font-medium" title={reference.label}>
                      {reference.label || 'Approved poster'}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${reference.label || 'poster'}`}
                    className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-slate-950/80 text-white opacity-100 shadow-lg sm:opacity-0 sm:group-hover:opacity-100"
                    disabled={referenceBusy}
                    onClick={() => void removePosterReference(reference.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
              No reference posters yet. AI continues using your colors, fonts and Image style.
            </p>
          )}
        </div>

        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
          Click Save brand kit below. Already-generated posts keep their old plate until you open
          them in Approvals and reframe.
        </p>
        <SectionSaveBar
          label="Save brand kit"
          saving={kitSaving}
          result={kitResult}
          onSave={() => void saveBrandKit()}
        />
      </SectionCard>

      <SectionCard
        icon={Globe2}
        title="Market countries"
        description="AI copy, posters, memes, and trend search localize to these markets. Choose Worldwide, or pick specific countries — including all six GCC states."
      >
        <MarketCountriesPicker
          value={form.targetCountries}
          onToggle={toggleCountry}
          onSet={setCountries}
        />
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
          Used in AI Assistant, captions, posters, calendar, trends, and Memes (Reddit + Google Trends geos).
        </p>
        <SectionSaveBar
          label="Save markets"
          saving={saving}
          result={saved ? 'ok' : error ? 'err' : null}
          onSave={() => void save()}
        />
      </SectionCard>

      <SectionCard
        icon={ImageIcon}
        title="Voice, sector & brand guidelines"
        description={
          form.brandType === 'b2b'
            ? 'For B2B, these fill from your website on save. Edit any box — human edits win on the next Save (unless you re-scrape).'
            : 'Guides copy tone and image prompts. B2C brands fill these manually.'
        }
      >
        {form.brandType === 'b2b' && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.25)] px-3 py-2.5">
            <p className="flex-1 text-xs text-[hsl(var(--muted-foreground))]">
              {form.websiteScrapedAt
                ? `Last scraped ${new Date(form.websiteScrapedAt).toLocaleString()}. Use Analyze website above to review voice, guidelines and Brand Kit colours together.`
                : 'Not analyzed yet. Use Analyze website above to review voice, guidelines and Brand Kit colours before saving.'}
            </p>
            <ProcessingButton
              type="button"
              variant="sector-outline"
              className="!min-h-[44px] !px-3 text-xs md:!min-h-[40px]"
              loading={scraping}
              loadingText="Scraping site…"
              disabled={scraping || saving || !form.websiteUrl.trim()}
              onClick={() => void rescrape()}
            >
              Scrape website now
            </ProcessingButton>
          </div>
        )}
        <div className="space-y-3">
          {scrapedFields.map(({ key, label, placeholder, rows }) => (
            <Field key={key} label={label}>
              <textarea
                className="input resize-y"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                placeholder={placeholder}
                rows={rows}
              />
            </Field>
          ))}
        </div>
      </SectionCard>

      <ChangePasswordCard />

      {error && <InlineNotice kind="error">{error}</InlineNotice>}
      {okMsg && <InlineNotice kind="success">{okMsg}</InlineNotice>}
      <StickySave
        saved={saved}
        loading={saving || scraping}
        onClick={() => void save()}
        label="Save company profile"
      />
    </div>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const changePassword = async () => {
    setError('');
    setOkMsg('');
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Fill in current password, new password, and confirmation.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (currentPassword === newPassword) {
      setError('New password must be different from the current password.');
      return;
    }
    setSaving(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword, confirmPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setOkMsg('Password updated.');
      notifySuccess('Password changed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not change password';
      setError(msg);
      notifyError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      icon={Lock}
      title="Change password"
      description="Account-wide — same password for every company (Arisio, Hyperthinks, etc.). Brand data stays separate."
    >
      <div className="mb-3 rounded-xl border border-sky-500/20 bg-sky-500/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-sky-900 dark:text-sky-200">
        Changing password here updates your login for all companies under this email.
      </div>
      <div className="grid gap-3 sm:grid-cols-1 max-w-md">
        <Field label="Current password">
          <PasswordInput
            className="input"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <Field label="New password">
          <PasswordInput
            className="input"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </Field>
        <Field label="Confirm new password">
          <PasswordInput
            className="input"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat new password"
          />
        </Field>
      </div>
      {error && <InlineNotice kind="error">{error}</InlineNotice>}
      {okMsg && <InlineNotice kind="success">{okMsg}</InlineNotice>}
      <div className="flex justify-end pt-1">
        <ProcessingButton
          type="button"
          variant="sector"
          className="!min-h-[48px] !px-5"
          loading={saving}
          loadingText="Updating…"
          disabled={saving}
          onClick={() => void changePassword()}
        >
          Update password
        </ProcessingButton>
      </div>
    </SectionCard>
  );
}

type ModelOpt = { id: string; label: string; group?: string };

function ModelPicker({
  value,
  models,
  onChange,
}: {
  value: string;
  models: ModelOpt[];
  onChange: (id: string) => void;
}) {
  const groups = (() => {
    const map = new Map<string, ModelOpt[]>();
    for (const m of models) {
      const g = m.group || 'Other';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(m);
    }
    return [...map.entries()];
  })();

  const hasGroups = groups.length > 1 || (groups[0]?.[0] !== 'Other' && Boolean(groups[0]?.[0]));
  const known = models.some((m) => m.id === value);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Model</p>
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
          {models.length} available · pick one
        </span>
      </div>

      <select
        className="input"
        value={known ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {!known && (
          <option value="" disabled>
            Select a model…
          </option>
        )}
        {hasGroups
          ? groups.map(([group, opts]) => (
              <optgroup key={group} label={group}>
                {opts.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.id})
                  </option>
                ))}
              </optgroup>
            ))
          : models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.id})
              </option>
            ))}
      </select>
    </div>
  );
}

function StickySave({
  saved,
  loading = false,
  onClick,
  label,
  disabled,
}: {
  saved: boolean;
  loading?: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-20 md:bottom-3">
      <div className="settings-sticky-save">
        <p className="text-xs text-slate-600 dark:text-slate-300 flex-1 px-1 font-medium">
          Changes apply to new generations after you save.
        </p>
        <ProcessingButton
          onClick={onClick}
          disabled={disabled}
          loading={loading}
          loadingText="Saving changes…"
          variant="sector"
          className="w-full sm:w-auto min-w-[180px] !min-h-[48px] text-sm tracking-tight"
          icon={saved ? <Check size={16} /> : undefined}
        >
          {saved ? 'Saved' : label}
        </ProcessingButton>
      </div>
    </div>
  );
}

function IntegrationsSettings() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [catalogs, setCatalogs] = useState<{
    openaiModels: ModelOpt[];
    claudeModels: ModelOpt[];
    falImageModels: ModelOpt[];
    openaiImageModels: ModelOpt[];
  }>({ openaiModels: [], claudeModels: [], falImageModels: [], openaiImageModels: [] });
  const [form, setForm] = useState({
    llmProvider: 'openai',
    llmModel: 'gpt-4o',
    openaiApiKey: '',
    claudeApiKey: '',
    claudeWorkspaceId: '',
    imageProvider: 'fal',
    falModel: 'fal-ai/flux-2-pro',
    falApiKey: '',
    imageRoutingMode: 'auto' as 'auto' | 'manual',
    searchProvider: 'tavily',
    tavilyApiKey: '',
    serpapiApiKey: '',
    apifyApiToken: '',
    placidApiKey: '',
    notificationProvider: 'slack' as 'slack' | 'teams' | 'email',
    slackWebhookUrl: '',
    teamsWebhookUrl: '',
    resendApiKey: '',
    notificationEmail: '',
    soundAlertsEnabled: true,
    trendsMode: 'manual' as 'manual' | 'auto',
    competitorMode: 'manual' as 'manual' | 'auto',
    competitorImageMode: 'new_topic' as 'new_topic' | 'near_mirror',
    newsletterMode: 'manual' as 'manual' | 'auto',
  });
  const [sectionBusy, setSectionBusy] = useState<string | null>(null);
  const [sectionResult, setSectionResult] = useState<Record<string, 'ok' | 'err'>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const applyStatus = (data: Record<string, unknown>) => {
    setStatus(data);
    const cats = data.catalogs as typeof catalogs | undefined;
    if (cats) setCatalogs(cats);
    setForm((f) => ({
      ...f,
      llmProvider: String(data.llmProvider ?? 'openai'),
      llmModel: String(data.llmModel ?? 'gpt-4o'),
      claudeWorkspaceId: String(data.claudeWorkspaceId ?? ''),
      imageProvider: String(data.imageProvider ?? 'fal'),
      falModel: String(data.falModel ?? 'fal-ai/flux-2-pro'),
      imageRoutingMode: data.imageRoutingMode === 'manual' ? 'manual' : 'auto',
      searchProvider: String(data.searchProvider ?? 'tavily'),
      notificationProvider:
        data.notificationProvider === 'teams' || data.notificationProvider === 'email'
          ? data.notificationProvider
          : 'slack',
      notificationEmail: String(data.notificationEmail ?? ''),
      soundAlertsEnabled: data.soundAlertsEnabled !== false,
      trendsMode: data.trendsMode === 'auto' ? 'auto' : 'manual',
      competitorMode: data.competitorMode === 'auto' ? 'auto' : 'manual',
      competitorImageMode: data.competitorImageMode === 'near_mirror' ? 'near_mirror' : 'new_topic',
      newsletterMode: data.newsletterMode === 'auto' ? 'auto' : 'manual',
    }));
  };

  useEffect(() => {
    setStatus(null);
    setError('');
    api<{ data: Record<string, unknown> }>('/settings/providers')
      .then((res) => applyStatus(res.data))
      .catch((e) => setError(e.message));
    // Refetch when active company changes — keys are shared, but heal empty tenants
  }, [user?.tenantId]);

  const flashSection = (id: string, ok: boolean) => {
    setSectionResult((prev) => ({ ...prev, [id]: ok ? 'ok' : 'err' }));
    window.setTimeout(() => {
      setSectionResult((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 2500);
  };

  const putProviders = async (body: Record<string, string | boolean>, clearKeys: (keyof typeof form)[] = []) => {
    const res = await api<{ data: Record<string, unknown> }>('/settings/providers', {
      method: 'PUT',
      body,
    });
    applyStatus(res.data);
    if (clearKeys.length) {
      setForm((f) => {
        const next = { ...f };
        for (const k of clearKeys) {
          if (typeof next[k] === 'string') (next as Record<string, unknown>)[k] = '';
        }
        return next;
      });
    }
    return res.data;
  };

  const saveSection = async (
    id: string,
    body: Record<string, string | boolean>,
    clearKeys: (keyof typeof form)[] = [],
    successMessage = 'Saved',
  ) => {
    setError('');
    setSectionBusy(id);
    try {
      await putProviders(body, clearKeys);
      flashSection(id, true);
      notifySuccess(successMessage);
    } catch (e) {
      flashSection(id, false);
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setSectionBusy(null);
    }
  };

  const secret = (value: string) => {
    const t = value.trim();
    return t || undefined;
  };

  const saveAll = async () => {
    try {
      setError('');
      setSaving(true);
      const body: Record<string, string | boolean> = {
        llmProvider: form.llmProvider,
        llmModel: form.llmModel,
        imageProvider: form.imageProvider,
        falModel: form.falModel,
        imageRoutingMode: form.imageRoutingMode,
        searchProvider: form.searchProvider,
        notificationProvider: form.notificationProvider,
        soundAlertsEnabled: form.soundAlertsEnabled,
        claudeWorkspaceId: form.claudeWorkspaceId.trim(),
        trendsMode: form.trendsMode,
        competitorMode: form.competitorMode,
        competitorImageMode: form.competitorImageMode,
        newsletterMode: form.newsletterMode,
      };
      const openai = secret(form.openaiApiKey);
      const claude = secret(form.claudeApiKey);
      const fal = secret(form.falApiKey);
      const tavily = secret(form.tavilyApiKey);
      const serpapi = secret(form.serpapiApiKey);
      const apify = secret(form.apifyApiToken);
      const placid = secret(form.placidApiKey);
      const slack = secret(form.slackWebhookUrl);
      const teams = secret(form.teamsWebhookUrl);
      if (openai) body.openaiApiKey = openai;
      if (claude) body.claudeApiKey = claude;
      if (fal) body.falApiKey = fal;
      if (tavily) body.tavilyApiKey = tavily;
      if (serpapi) body.serpapiApiKey = serpapi;
      if (apify) body.apifyApiToken = apify;
      if (placid) body.placidApiKey = placid;
      if (slack) body.slackWebhookUrl = slack;
      if (teams) body.teamsWebhookUrl = teams;

      await putProviders(body, [
        'openaiApiKey',
        'claudeApiKey',
        'falApiKey',
        'tavilyApiKey',
        'serpapiApiKey',
        'apifyApiToken',
        'placidApiKey',
        'slackWebhookUrl',
        'teamsWebhookUrl',
      ]);
      setSaved(true);
      flashSection('all', true);
      setTimeout(() => setSaved(false), 2000);
      notifySuccess('Integrations saved');
    } catch (e) {
      flashSection('all', false);
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setSaving(false);
    }
  };

  const llmModels: ModelOpt[] = form.llmProvider === 'claude'
    ? (catalogs.claudeModels.length ? catalogs.claudeModels : [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5', group: 'Claude 5' }])
    : (catalogs.openaiModels.length ? catalogs.openaiModels : [{ id: 'gpt-4o', label: 'GPT-4o', group: 'GPT-4o' }]);

  const imageModels: ModelOpt[] = form.imageProvider === 'openai'
    ? (catalogs.openaiImageModels.length ? catalogs.openaiImageModels : [{ id: 'gpt-image-1', label: 'GPT Image 1', group: 'OpenAI Images' }])
    : (catalogs.falImageModels.length ? catalogs.falImageModels : [{ id: 'fal-ai/flux-2-pro', label: 'FLUX.2 Pro', group: 'FLUX.2' }]);

  return (
    <div className="space-y-4 pb-24">
      <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] px-4 py-3 text-sm text-sky-950 dark:text-sky-100">
        <p className="font-semibold">Shared across all companies</p>
        <p className="mt-1 text-xs leading-relaxed text-sky-900/80 dark:text-sky-200/90">
          API keys and model choices apply to every brand (Arisio, Hyperthinks, Risin, …). Company
          profile, topics, calendar, newsletter, and logs stay separate per brand.
        </p>
      </div>
      <SectionCard
        icon={KeyRound}
        title="Text model"
        description="Choose one provider and one model. Engines use this for every draft."
      >
        <ChoiceCards
          value={form.llmProvider as 'openai' | 'claude'}
          onChange={(p) => setForm({
            ...form,
            llmProvider: p,
            llmModel: p === 'openai' ? 'gpt-4o' : 'claude-sonnet-5',
          })}
          options={[
            { id: 'openai', label: 'OpenAI', hint: 'GPT & reasoning models' },
            { id: 'claude', label: 'Anthropic Claude', hint: 'Sonnet, Opus, Haiku' },
          ]}
        />
        <ModelPicker
          value={form.llmModel}
          models={llmModels}
          onChange={(id) => setForm({ ...form, llmModel: id })}
        />
        <div className="grid gap-3 sm:grid-cols-1 pt-1">
          {form.llmProvider === 'openai' ? (
            <Field label="OpenAI API Key" status={Boolean(status?.openaiApiKeySet)}>
              <PasswordInput
                className="input"
                placeholder="sk-… (leave blank to keep)"
                value={form.openaiApiKey}
                onChange={(e) => setForm({ ...form, openaiApiKey: e.target.value })}
                autoComplete="off"
              />
            </Field>
          ) : (
            <>
              <Field label="Anthropic API Key" status={Boolean(status?.claudeApiKeySet)}>
                <PasswordInput
                  className="input"
                  placeholder="sk-ant-…"
                  value={form.claudeApiKey}
                  onChange={(e) => setForm({ ...form, claudeApiKey: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label="Anthropic Workspace ID" status={Boolean(status?.claudeWorkspaceIdSet)}>
                <input
                  className="input"
                  placeholder="wrkspc_… (required for identity-linked keys)"
                  value={form.claudeWorkspaceId}
                  onChange={(e) => setForm({ ...form, claudeWorkspaceId: e.target.value })}
                  autoComplete="off"
                />
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
                  Claude Console → Settings → Workspaces. Needed if your key is not scoped to a single workspace.
                </p>
              </Field>
            </>
          )}
        </div>
        <SectionSaveBar
          label="Save text model"
          saving={sectionBusy === 'llm'}
          result={sectionResult.llm ?? null}
          onSave={() => {
            const body: Record<string, string | boolean> = {
              llmProvider: form.llmProvider,
              llmModel: form.llmModel,
            };
            const clear: (keyof typeof form)[] = [];
            if (form.llmProvider === 'openai') {
              const k = secret(form.openaiApiKey);
              if (k) { body.openaiApiKey = k; clear.push('openaiApiKey'); }
            } else {
              const k = secret(form.claudeApiKey);
              if (k) { body.claudeApiKey = k; clear.push('claudeApiKey'); }
              body.claudeWorkspaceId = form.claudeWorkspaceId.trim();
            }
            void saveSection('llm', body, clear, 'Text model saved');
          }}
        />
      </SectionCard>

      <SectionCard
        icon={ImageIcon}
        title="Image generation"
        description="Auto always uses a high-end model for the brief. If that model is out of credits or a key is missing, generation stops — we never fall back to Flux Dev or other cheap models."
      >
        <ChoiceCards
          value={form.imageRoutingMode}
          onChange={(mode) => setForm({ ...form, imageRoutingMode: mode })}
          options={[
            {
              id: 'auto',
              label: 'Auto (Smart Router)',
              hint: 'High-end only (FLUX.2 Pro, GPT-6 Astra…) — never cheap fallbacks',
            },
            {
              id: 'manual',
              label: 'Manual (pinned model)',
              hint: 'Always use the model below; remaps if that key is missing',
            },
          ]}
        />
        {form.imageRoutingMode === 'manual' ? (
          <>
            <ChoiceCards
              value={form.imageProvider as 'fal' | 'openai'}
              onChange={(p) => setForm({
                ...form,
                imageProvider: p,
                falModel: p === 'fal' ? 'fal-ai/flux-2-pro' : 'gpt-6-astra',
              })}
              options={[
                { id: 'fal', label: 'fal.ai', hint: 'FLUX, Ideogram, GPT Image 2.5…' },
                { id: 'openai', label: 'OpenAI Images', hint: 'GPT-6 Astra, GPT Image, DALL·E' },
              ]}
            />
            <ModelPicker
              value={form.falModel}
              models={imageModels}
              onChange={(id) => setForm({ ...form, falModel: id })}
            />
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Every generate uses this pinned model when the API key allows it.
            </p>
          </>
        ) : (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Auto picks FLUX.2 Max/Pro, Recraft V4, Ideogram V3, Nano Banana Pro, GPT Image 2.5 Sunburst, or GPT-6 Astra from the brief. If those keys or credits are missing, you will see an error instead of a low-quality image. Add fal.ai and OpenAI keys below so both high-end paths can run.
          </p>
        )}
        {(form.imageRoutingMode === 'auto' || form.imageProvider === 'fal') && (
          <Field label="fal.ai API Key" status={Boolean(status?.falApiKeySet)}>
            <PasswordInput
              className="input"
              placeholder="fal key…"
              value={form.falApiKey}
              onChange={(e) => setForm({ ...form, falApiKey: e.target.value })}
              autoComplete="off"
            />
          </Field>
        )}
        {(form.imageRoutingMode === 'auto' || form.imageProvider === 'openai') && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            OpenAI images use the OpenAI API key from Text model above (GPT-6 Astra, GPT Image 2.5, etc.).
          </p>
        )}
        <SectionSaveBar
          label="Save image settings"
          saving={sectionBusy === 'image'}
          result={sectionResult.image ?? null}
          onSave={() => {
            const body: Record<string, string | boolean> = {
              imageProvider: form.imageProvider,
              falModel: form.falModel,
              imageRoutingMode: form.imageRoutingMode,
            };
            const clear: (keyof typeof form)[] = [];
            if (form.imageRoutingMode === 'auto' || form.imageProvider === 'fal') {
              const k = secret(form.falApiKey);
              if (k) { body.falApiKey = k; clear.push('falApiKey'); }
            }
            void saveSection('image', body, clear, 'Image settings saved');
          }}
        />
      </SectionCard>

      <SectionCard
        icon={Globe2}
        title="Trend search"
        description="Powers the Trends engine with live industry signals."
      >
        <ChoiceCards
          value={form.searchProvider as 'tavily' | 'serpapi'}
          onChange={(p) => setForm({ ...form, searchProvider: p })}
          options={[
            { id: 'tavily', label: 'Tavily', hint: 'Recommended for topics' },
            { id: 'serpapi', label: 'SerpAPI', hint: 'Google-backed results' },
          ]}
        />
        {form.searchProvider === 'tavily' ? (
          <Field label="Tavily API Key" status={Boolean(status?.tavilyApiKeySet)}>
            <PasswordInput
              className="input"
              placeholder="tvly-…"
              value={form.tavilyApiKey}
              onChange={(e) => setForm({ ...form, tavilyApiKey: e.target.value })}
              autoComplete="off"
            />
          </Field>
        ) : (
          <Field label="SerpAPI Key" status={Boolean(status?.serpapiApiKeySet)}>
            <PasswordInput
              className="input"
              placeholder="Optional"
              value={form.serpapiApiKey}
              onChange={(e) => setForm({ ...form, serpapiApiKey: e.target.value })}
              autoComplete="off"
            />
          </Field>
        )}
        <SectionSaveBar
          label="Save search key"
          saving={sectionBusy === 'search'}
          result={sectionResult.search ?? null}
          onSave={() => {
            const body: Record<string, string | boolean> = {
              searchProvider: form.searchProvider,
            };
            const clear: (keyof typeof form)[] = [];
            if (form.searchProvider === 'tavily') {
              const k = secret(form.tavilyApiKey);
              if (k) { body.tavilyApiKey = k; clear.push('tavilyApiKey'); }
            } else {
              const k = secret(form.serpapiApiKey);
              if (k) { body.serpapiApiKey = k; clear.push('serpapiApiKey'); }
            }
            void saveSection('search', body, clear, 'Search settings saved');
          }}
        />
      </SectionCard>

      <SectionCard
        icon={LayoutTemplate}
        title="Placid templates"
        description="Connect your Placid project to import designs into Brand Studio and fill dynamic layers."
      >
        <Field label="Placid API Token" status={Boolean(status?.placidApiKeySet)}>
          <PasswordInput
            className="input"
            placeholder="From Placid > Project > API Tokens"
            value={form.placidApiKey}
            onChange={(e) => setForm({ ...form, placidApiKey: e.target.value })}
            autoComplete="off"
          />
        </Field>
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
          Paste the token only (no labels). After saving, open{' '}
          <a href="/brand-studio" className="underline text-brand-600">
            Brand Studio
          </a>{' '}
          to browse and import templates. Mark layers Dynamic in Placid for AI fill.
        </p>
        <SectionSaveBar
          label="Save Placid token"
          saving={sectionBusy === 'placid'}
          result={sectionResult.placid ?? null}
          onSave={() => {
            const k = secret(form.placidApiKey);
            if (!k) {
              if (status?.placidApiKeySet) {
                flashSection('placid', true);
                notifySuccess('Placid token already saved');
                return;
              }
              const msg = 'Enter a Placid API token before saving';
              setError(msg);
              flashSection('placid', false);
              toast.error(msg);
              return;
            }
            void saveSection('placid', { placidApiKey: k }, ['placidApiKey'], 'Placid token saved');
          }}
        />
      </SectionCard>

      <SectionCard
        icon={Radar}
        title="Competitor scraping"
        description="Apify pulls public posts and comments for competitor analysis."
      >
        <Field label="Apify API Token" status={Boolean(status?.apifyApiTokenSet)}>
          <PasswordInput
            className="input"
            placeholder="apify_api_…"
            value={form.apifyApiToken}
            onChange={(e) => setForm({ ...form, apifyApiToken: e.target.value })}
            autoComplete="off"
          />
        </Field>
        <SectionSaveBar
          label="Save Apify token"
          saving={sectionBusy === 'apify'}
          result={sectionResult.apify ?? null}
          onSave={() => {
            const k = secret(form.apifyApiToken);
            if (!k) {
              if (status?.apifyApiTokenSet) {
                flashSection('apify', true);
                notifySuccess('Apify token already saved');
                return;
              }
              const msg = 'Enter an Apify API token before saving';
              setError(msg);
              flashSection('apify', false);
              toast.error(msg);
              return;
            }
            void saveSection('apify', { apifyApiToken: k }, ['apifyApiToken'], 'Apify token saved');
          }}
        />
      </SectionCard>

      <SectionCard
        icon={Globe2}
        title="Trends workflow"
        description="Manual: pick 7-day news then generate. Auto: rotate Settings topics and run end-to-end."
      >
        <ChoiceCards
          value={form.trendsMode}
          onChange={(m) => setForm({ ...form, trendsMode: m })}
          options={[
            { id: 'manual', label: 'Manual', hint: 'Discover → choose sources → generate' },
            { id: 'auto', label: 'Auto', hint: 'One-click using Settings topics + providers' },
          ]}
        />
        <SectionSaveBar
          label="Save trends mode"
          saving={sectionBusy === 'trends'}
          result={sectionResult.trends ?? null}
          onSave={() => {
            void saveSection('trends', { trendsMode: form.trendsMode }, [], 'Trends mode saved');
          }}
        />
      </SectionCard>

      <SectionCard
        icon={Radar}
        title="Competitor Monitor workflow"
        description="Manual: scrape posts, pick one, create similar. Auto: pick the best post and generate brand-styled content."
      >
        <ChoiceCards
          value={form.competitorMode}
          onChange={(m) => setForm({ ...form, competitorMode: m })}
          options={[
            { id: 'manual', label: 'Manual', hint: 'Scrape → choose a post → create similar' },
            { id: 'auto', label: 'Auto', hint: 'Best-engagement post → brand-styled similar content' },
          ]}
        />
        <SectionSaveBar
          label="Save competitor mode"
          saving={sectionBusy === 'competitorMode'}
          result={sectionResult.competitorMode ?? null}
          onSave={() => {
            void saveSection('competitorMode', { competitorMode: form.competitorMode }, [], 'Competitor mode saved');
          }}
        />
        <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Competitor image style</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Used for manual create, auto run, and scheduled competitor automation.
            </p>
          </div>
          <ChoiceCards
            value={form.competitorImageMode}
            onChange={(m) => setForm({ ...form, competitorImageMode: m })}
            options={[
              {
                id: 'new_topic',
                label: 'New topic image',
                hint: 'Fresh AI photo from the caption. With a Brand template, that AI photo fills the picture zones.',
              },
              {
                id: 'near_mirror',
                label: 'Exact scraped image',
                hint: 'Reuse that post’s photo as-is. With a Brand template, the scraped photo fills the picture zones (no AI art).',
              },
            ]}
          />
          <SectionSaveBar
            label="Save competitor image style"
            saving={sectionBusy === 'competitorImageMode'}
            result={sectionResult.competitorImageMode ?? null}
            onSave={() => {
              void saveSection(
                'competitorImageMode',
                { competitorImageMode: form.competitorImageMode },
                [],
                'Competitor image style saved',
              );
            }}
          />
        </div>
      </SectionCard>

      <SectionCard
        icon={Mail}
        title="Product Newsletter mode"
        description="Manual = pick document & rules on the Newsletter page. Auto = one-click rotate docs/formats."
      >
        <ChoiceCards
          value={form.newsletterMode}
          onChange={(m) => setForm({ ...form, newsletterMode: m })}
          options={[
            { id: 'manual', label: 'Manual', hint: 'Choose document, rules, and visual each time' },
            { id: 'auto', label: 'Auto', hint: 'Rotate documents & formats on Run' },
          ]}
        />
        <SectionSaveBar
          label="Save newsletter mode"
          saving={sectionBusy === 'newsletterMode'}
          result={sectionResult.newsletterMode ?? null}
          onSave={() => {
            void saveSection('newsletterMode', { newsletterMode: form.newsletterMode }, [], 'Newsletter mode saved');
          }}
        />
      </SectionCard>

      <SectionCard
        icon={Bell}
        title="Alerts"
        description="In-app sound plus Slack and/or Microsoft Teams. New drafts include company name, image, caption, hashtags, and Post / Reject links. After publish you get platform links and date/time."
      >
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-2">
          <Toggle
            checked={form.soundAlertsEnabled}
            onCheckedChange={(soundAlertsEnabled) => setForm({ ...form, soundAlertsEnabled })}
            label="Sound alerts"
            description="Play when errors or jobs complete."
          />
        </div>
        <div className="space-y-1.5">
          <label className="label !mb-0">Alert channel</label>
          <ChoiceCards
            value={form.notificationProvider}
            onChange={(notificationProvider) => setForm({ ...form, notificationProvider })}
            options={[
              { id: 'slack', label: 'Slack', hint: 'Incoming webhook to a channel' },
              { id: 'teams', label: 'Microsoft Teams', hint: 'Incoming webhook to a channel' },
              { id: 'email', label: 'Email (Resend)', hint: 'Free transactional email via Resend' },
            ]}
          />
        </div>
        {form.notificationProvider === 'slack' && (
          <Field label="Slack Webhook" status={Boolean(status?.slackWebhookUrlSet)}>
            <PasswordInput
              className="input"
              placeholder="https://hooks.slack.com/…"
              value={form.slackWebhookUrl}
              onChange={(e) => setForm({ ...form, slackWebhookUrl: e.target.value })}
              autoComplete="off"
            />
          </Field>
        )}
        {form.notificationProvider === 'teams' && (
          <Field label="Teams Webhook" status={Boolean(status?.teamsWebhookUrlSet)}>
            <PasswordInput
              className="input"
              placeholder="https://….webhook.office.com/…"
              value={form.teamsWebhookUrl}
              onChange={(e) => setForm({ ...form, teamsWebhookUrl: e.target.value })}
              autoComplete="off"
            />
          </Field>
        )}
        {form.notificationProvider === 'email' && (
          <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4">
            <Field label="Resend API key" status={Boolean(status?.resendApiKeySet)}>
              <PasswordInput
                className="input"
                placeholder="re_…"
                value={form.resendApiKey}
                onChange={(e) => setForm({ ...form, resendApiKey: e.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field label="Alert email (to)" status={Boolean(form.notificationEmail || status?.notificationEmail)}>
              <input
                className="input"
                type="email"
                placeholder="you@company.com"
                value={form.notificationEmail}
                onChange={(e) => setForm({ ...form, notificationEmail: e.target.value })}
                autoComplete="email"
              />
            </Field>
            <p className="text-[11px] leading-snug text-[hsl(var(--muted-foreground))]">
              Free Resend plan: 100 emails/day · 3,000/month. Use a verified domain as From
              (<code className="text-[10px]">NOTIFICATION_FROM_EMAIL</code>), or{' '}
              <code className="text-[10px]">beth.t@example.com</code> for tests to your Resend account email.
            </p>
            <button
              type="button"
              className="btn-secondary min-h-[44px] md:!min-h-[40px] !rounded-xl text-xs font-semibold"
              disabled={sectionBusy === 'testEmail'}
              onClick={() => {
                void (async () => {
                  setSectionBusy('testEmail');
                  try {
                    // Save email settings first so the test uses the latest key/to
                    const body: Record<string, string | boolean> = {
                      notificationProvider: 'email',
                      notificationEmail: form.notificationEmail.trim(),
                    };
                    const key = secret(form.resendApiKey);
                    if (key) body.resendApiKey = key;
                    await putProviders(body, key ? ['resendApiKey'] : []);
                    const res = await api<{ data: { to: string; message: string } }>(
                      '/settings/providers/test-email',
                      {
                        method: 'POST',
                        body: form.notificationEmail.trim()
                          ? { to: form.notificationEmail.trim() }
                          : {},
                      },
                    );
                    flashSection('alerts', true);
                    notifySuccess(res.data?.message || `Test email sent to ${res.data?.to}`);
                  } catch (e) {
                    flashSection('alerts', false);
                    notifyError(e instanceof Error ? e.message : 'Resend test failed');
                  } finally {
                    setSectionBusy(null);
                  }
                })();
              }}
            >
              {sectionBusy === 'testEmail' ? 'Sending…' : 'Send test email via Resend'}
            </button>
          </div>
        )}
        {form.notificationProvider === 'email' && (
          <p className="text-xs text-[hsl(var(--muted-foreground))] rounded-xl border border-[hsl(var(--border))] px-3 py-2">
            Email alerts use Resend. Slack/Teams webhooks are ignored while Email is selected.
          </p>
        )}
        <SectionSaveBar
          label="Save alerts"
          saving={sectionBusy === 'alerts'}
          result={sectionResult.alerts ?? null}
          onSave={() => {
            const body: Record<string, string | boolean> = {
              soundAlertsEnabled: form.soundAlertsEnabled,
              notificationProvider: form.notificationProvider,
            };
            const clear: (keyof typeof form)[] = [];
            const slack = secret(form.slackWebhookUrl);
            if (slack) { body.slackWebhookUrl = slack; clear.push('slackWebhookUrl'); }
            const teams = secret(form.teamsWebhookUrl);
            if (teams) { body.teamsWebhookUrl = teams; clear.push('teamsWebhookUrl'); }
            const resend = secret(form.resendApiKey);
            if (resend) { body.resendApiKey = resend; clear.push('resendApiKey'); }
            if (form.notificationProvider === 'email') {
              body.notificationEmail = form.notificationEmail.trim();
            }
            void saveSection('alerts', body, clear, 'Alert settings saved');
          }}
        />
      </SectionCard>

      {error && (
        <p className="text-sm text-slate-800 bg-slate-100 rounded-xl px-3 py-2 border border-slate-200 dark:text-slate-100 dark:bg-slate-800 dark:border-slate-600">{error}</p>
      )}
      <StickySave
        saved={saved}
        loading={saving}
        onClick={saveAll}
        label="Save all integrations"
        disabled={saving || sectionBusy !== null}
      />
    </div>
  );
}

function EmptyList({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-10 text-center">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">{message}</p>
    </div>
  );
}

function ListRow({
  title,
  subtitle,
  deleted,
  active,
  onToggleActive,
  activeLabel = 'Scrape',
  children,
  onDelete,
  onRestore,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  deleted?: boolean;
  /** When set, shows an on/off control (does not delete the row). */
  active?: boolean;
  onToggleActive?: (next: boolean) => void | Promise<void>;
  activeLabel?: string;
  children?: ReactNode;
  onDelete: () => void | Promise<void>;
  onRestore?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (fn?: () => void | Promise<void>) => {
    if (!fn || busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`flex flex-col gap-2.5 px-4 py-3.5 border-b border-[hsl(var(--border))] last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3 ${
        active === false && !deleted ? 'bg-[hsl(var(--muted))]/35' : ''
      }`}
    >
      <div className={`min-w-0 flex-1 ${active === false && !deleted ? 'opacity-70' : ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          <p className={`font-medium ${deleted ? 'opacity-60 line-through' : ''}`}>{title}</p>
          {active === false && !deleted && (
            <span className="rounded-md bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Off
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 break-all">{subtitle}</p>
        )}
        {children}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {!deleted && onToggleActive && typeof active === 'boolean' && (
          <div className="flex min-h-[40px] items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1.5">
            <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] whitespace-nowrap">
              {activeLabel}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              aria-label={`${activeLabel} ${title}`}
              disabled={busy}
              data-checked={active}
              className="switch !h-6 !w-10 shrink-0"
              onClick={() => void run(() => onToggleActive(!active))}
            >
              <span className="switch-thumb" />
            </button>
          </div>
        )}
        {deleted && onRestore ? (
          <button
            type="button"
            className="btn-sector-outline min-h-[44px] md:!min-h-[40px] !px-3 text-xs gap-1.5"
            disabled={busy}
            onClick={() => void run(onRestore)}
          >
            <RotateCcw size={14} /> {busy ? '…' : 'Restore'}
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-slate-900 px-3 py-2 text-xs font-semibold text-white min-h-[40px] hover:bg-slate-800 transition-colors disabled:opacity-50 dark:border-slate-600 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            title="Delete"
            disabled={busy}
            onClick={() => void run(onDelete)}
          >
            <Trash2 size={14} /> {busy ? '…' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}

function TopicsSettings() {
  const [topics, setTopics] = useState<Array<{ id: string; name: string; searchKeywords: string; isActive: boolean; deletedAt?: string | null }>>([]);
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const bulkFileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    api<{ data: typeof topics }>('/settings/topics')
      .then((r) => setTopics(r.data))
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  const runAuto = async () => {
    setAutoRunning(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{
        data: {
          created: number;
          skipped: number;
          warnings: string[];
          brand: { companyName: string; websiteUrl: string; industry: string };
        };
      }>('/settings/topics/auto', { method: 'POST', body: {} });
      load();
      const msg = `Auto-added ${res.data.created} topic${res.data.created === 1 ? '' : 's'} from ${
        res.data.brand.companyName
      }${res.data.skipped ? ` · ${res.data.skipped} already existed` : ''}`;
      setOkMsg(msg);
      notifySuccess(msg);
      if (res.data.warnings?.length) setError(res.data.warnings.slice(0, 2).join(' '));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Auto discover failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setAutoRunning(false);
    }
  };

  const add = async () => {
    setAdding(true);
    setError('');
    setOkMsg('');
    try {
      await api('/settings/topics', { method: 'POST', body: { name, searchKeywords: keywords } });
      setName(''); setKeywords('');
      load();
      notifySuccess('Topic saved');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setAdding(false);
    }
  };

  const bulkAddText = async () => {
    if (!bulkText.trim()) return;
    setBulkSaving(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{
        data: { created: number; skipped: number; totalParsed: number; warnings: string[] };
      }>('/settings/topics/bulk', { method: 'POST', body: { text: bulkText } });
      setBulkText('');
      load();
      const msg = `Added ${res.data.created} topic${res.data.created === 1 ? '' : 's'}${
        res.data.skipped ? ` · ${res.data.skipped} skipped` : ''
      }`;
      setOkMsg(msg);
      notifySuccess(msg);
      if (res.data.warnings?.length) setError(res.data.warnings.slice(0, 3).join(' '));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Bulk add failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setBulkSaving(false);
    }
  };

  const bulkUploadFile = async (file: File) => {
    setBulkUploading(true);
    setError('');
    setOkMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiUpload<{
        data: { created: number; skipped: number; totalParsed: number; warnings: string[] };
      }>('/settings/topics/bulk', fd);
      load();
      const msg = `Imported ${res.data.created} topic${res.data.created === 1 ? '' : 's'} from file${
        res.data.skipped ? ` · ${res.data.skipped} skipped` : ''
      }`;
      setOkMsg(msg);
      notifySuccess(msg);
      if (res.data.warnings?.length) setError(res.data.warnings.slice(0, 3).join(' '));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setBulkUploading(false);
      if (bulkFileRef.current) bulkFileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard icon={Globe2} title="Add topic" description="Keywords feed the Trends search engine.">
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-brand-500/25 bg-brand-500/5 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Auto from website</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Scrapes your Company website + industry to suggest trend keywords, then saves new topics.
            </p>
          </div>
          <ProcessingButton
            onClick={() => void runAuto()}
            loading={autoRunning}
            loadingText="Discovering…"
            variant="sector"
            icon={<Sparkles size={16} />}
            disabled={bulkSaving || bulkUploading || adding}
            className="w-full shrink-0 sm:w-auto !min-h-[44px]"
          >
            Auto
          </ProcessingButton>
        </div>
        <Field label="Topic name">
          <input className="input" placeholder="e.g. AI infrastructure" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Search keywords">
          <input className="input" placeholder="Comma-separated terms for Tavily" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </Field>
        <ProcessingButton
          onClick={add}
          disabled={!name}
          loading={adding}
          loadingText="Adding topic…"
          variant="sector"
          icon={<Plus size={16} />}
          className="w-full sm:w-auto !min-h-[48px]"
        >
          Add topic
        </ProcessingButton>
      </SectionCard>

      <SectionCard
        icon={FileSpreadsheet}
        title="Bulk add trend keywords"
        description="Paste comma-separated keywords, or upload Excel/CSV. Each keyword becomes a topic."
      >
        <Field label="Comma-separated keywords">
          <textarea
            className="input min-h-[96px] resize-y"
            placeholder="AI infrastructure, IoT platforms, Fintech payments, Edge computing"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            disabled={bulkSaving || bulkUploading}
          />
        </Field>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <ProcessingButton
            onClick={() => void bulkAddText()}
            disabled={!bulkText.trim() || bulkUploading}
            loading={bulkSaving}
            loadingText="Adding…"
            variant="sector"
            icon={<Plus size={16} />}
            className="w-full sm:w-auto !min-h-[48px]"
          >
            Add all from text
          </ProcessingButton>
          <label
            className={`btn-sector-outline inline-flex cursor-pointer items-center justify-center gap-2 !min-h-[48px] ${
              bulkSaving || bulkUploading ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            {bulkUploading ? <Spinner size={15} /> : <Upload size={15} />}
            {bulkUploading ? 'Uploading…' : 'Upload Excel / CSV'}
            <input
              ref={bulkFileRef}
              type="file"
              accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              disabled={bulkSaving || bulkUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void bulkUploadFile(file);
              }}
            />
          </label>
          <a
            href="/api/settings/topics/bulk/template.xlsx"
            className="btn-ghost inline-flex items-center justify-center gap-2 !min-h-[44px] text-sm"
          >
            <FileSpreadsheet size={15} />
            Download template
          </a>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Excel columns: <code className="text-[11px]">name</code>, optional{' '}
          <code className="text-[11px]">searchKeywords</code>. Duplicates are skipped.
        </p>
      </SectionCard>

      <div className="px-1">
        <p className="text-sm font-medium">Your topics</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
          Turn Search off to keep a topic saved but skip it in Trends fetch — Delete removes it.
        </p>
      </div>

      {okMsg && <InlineNotice kind="success">{okMsg}</InlineNotice>}
      {error && <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{error}</p>}

      {topics.length === 0 ? (
        <EmptyList message="No topics yet — add one to start Trends rotation." />
      ) : (
        <div className="card !p-0 overflow-hidden">
          {topics.map((t) => (
            <ListRow
              key={t.id}
              title={t.name}
              subtitle={t.searchKeywords || undefined}
              active={t.isActive}
              activeLabel="Search"
              onToggleActive={async (next) => {
                await api(`/settings/topics/${t.id}`, {
                  method: 'PATCH',
                  body: { isActive: next },
                });
                setTopics((prev) =>
                  prev.map((row) => (row.id === t.id ? { ...row, isActive: next } : row)),
                );
                notifySuccess(next ? `“${t.name}” included in Trends` : `“${t.name}” paused`);
              }}
              onDelete={() => api(`/settings/topics/${t.id}`, { method: 'DELETE' }).then(load)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const SOCIAL_URL_FIELDS = [
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/…' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/…' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/…' },
  { key: 'twitter', label: 'Twitter / X', placeholder: 'https://x.com/…' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@…' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@…' },
  { key: 'website', label: 'Website', placeholder: 'https://…' },
] as const;

type SocialUrlKey = (typeof SOCIAL_URL_FIELDS)[number]['key'];
type SocialUrls = Partial<Record<SocialUrlKey, string>>;

function CompetitorsSettings() {
  const emptyUrls = (): SocialUrls => ({
    instagram: '',
    facebook: '',
    linkedin: '',
    twitter: '',
    youtube: '',
    tiktok: '',
    website: '',
  });

  const [competitors, setCompetitors] = useState<Array<{
    id: string;
    name: string;
    handle: string;
    platform: string;
    profileUrl?: string | null;
    socialUrls?: SocialUrls | null;
    isActive?: boolean;
    deletedAt?: string | null;
  }>>([]);
  const [form, setForm] = useState({
    name: '',
    platform: 'instagram',
    socialUrls: emptyUrls(),
  });
  const [bulkText, setBulkText] = useState('');
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const bulkFileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    api<{ data: typeof competitors }>('/settings/competitors')
      .then((r) => setCompetitors(r.data))
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  const filledSocialCount = Object.values(form.socialUrls).filter((v) => v.trim()).length;
  const canSave = Boolean(form.name.trim() && filledSocialCount > 0);

  const runAuto = async () => {
    setAutoRunning(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{
        data: {
          created: number;
          skipped: number;
          warnings: string[];
          brand: { companyName: string; websiteUrl: string; industry: string };
        };
      }>('/settings/competitors/auto', { method: 'POST', body: {} });
      load();
      const msg = `Auto-added ${res.data.created} competitor${res.data.created === 1 ? '' : 's'} from ${
        res.data.brand.companyName
      }${res.data.skipped ? ` · ${res.data.skipped} already tracked` : ''}`;
      setOkMsg(msg);
      notifySuccess(msg);
      if (res.data.warnings?.length) setError(res.data.warnings.slice(0, 2).join(' '));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Auto discover failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setAutoRunning(false);
    }
  };

  const add = async () => {
    if (!canSave) return;
    setAdding(true);
    try {
      setError('');
      setOkMsg('');
      await api('/settings/competitors', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          platform: form.platform,
          socialUrls: form.socialUrls,
        },
      });
      setForm({ name: '', platform: 'instagram', socialUrls: emptyUrls() });
      load();
      notifySuccess('Competitor saved');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setAdding(false);
    }
  };

  const bulkAddText = async () => {
    if (!bulkText.trim()) return;
    setBulkSaving(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{
        data: { created: number; skipped: number; totalParsed: number; warnings: string[] };
      }>('/settings/competitors/bulk', { method: 'POST', body: { text: bulkText } });
      setBulkText('');
      load();
      const msg = `Added ${res.data.created} competitor${res.data.created === 1 ? '' : 's'}${
        res.data.skipped ? ` · ${res.data.skipped} skipped` : ''
      }`;
      setOkMsg(msg);
      notifySuccess(msg);
      if (res.data.warnings?.length) setError(res.data.warnings.slice(0, 3).join(' '));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Bulk add failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setBulkSaving(false);
    }
  };

  const bulkUploadFile = async (file: File) => {
    setBulkUploading(true);
    setError('');
    setOkMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiUpload<{
        data: { created: number; skipped: number; totalParsed: number; warnings: string[] };
      }>('/settings/competitors/bulk', fd);
      load();
      const msg = `Imported ${res.data.created} competitor${res.data.created === 1 ? '' : 's'} from file${
        res.data.skipped ? ` · ${res.data.skipped} skipped` : ''
      }`;
      setOkMsg(msg);
      notifySuccess(msg);
      if (res.data.warnings?.length) setError(res.data.warnings.slice(0, 3).join(' '));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setBulkUploading(false);
      if (bulkFileRef.current) bulkFileRef.current.value = '';
    }
  };

  const linksFor = (c: (typeof competitors)[0]): Array<{ key: string; label: string; url: string }> => {
    const urls = (c.socialUrls && typeof c.socialUrls === 'object' ? c.socialUrls : {}) as SocialUrls;
    const out: Array<{ key: string; label: string; url: string }> = [];
    const seen = new Set<string>();
    for (const field of SOCIAL_URL_FIELDS) {
      const raw = urls[field.key];
      const url = typeof raw === 'string' ? raw.trim() : '';
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ key: field.key, label: field.label, url });
    }
    const legacy = (c.profileUrl || '').trim();
    if (legacy && !seen.has(legacy)) {
      out.push({ key: 'profile', label: c.platform || 'Profile', url: legacy });
    }
    return out;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-brand-500/30 bg-brand-500/5 px-4 py-3 text-sm">
        Manage who to track here. Open{' '}
        <a href="/competitors" className="font-medium text-brand-700 underline dark:text-brand-300">
          Competitor Monitor
        </a>{' '}
        to scrape posts, pick one, and create brand-styled similar content.
      </div>
      <SectionCard
        icon={Radar}
        title="Add competitor"
        description="Name + at least one social profile URL. Apify scrapes those saved URLs only."
      >
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-brand-500/25 bg-brand-500/5 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Auto from website</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Finds direct competitors and their Instagram, LinkedIn, Facebook, and X profiles from your
              Company website.
            </p>
          </div>
          <ProcessingButton
            onClick={() => void runAuto()}
            loading={autoRunning}
            loadingText="Scraping…"
            variant="sector"
            icon={<Sparkles size={16} />}
            disabled={bulkSaving || bulkUploading || adding}
            className="w-full shrink-0 sm:w-auto !min-h-[44px]"
          >
            Auto
          </ProcessingButton>
        </div>
        <Field label="Name">
          <input
            className="input"
            placeholder="Brand name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Primary platform (for scraping)">
          <select
            className="input"
            value={form.platform}
            onChange={(e) => setForm({ ...form, platform: e.target.value })}
          >
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="linkedin">LinkedIn</option>
            <option value="twitter">Twitter / X</option>
          </select>
        </Field>

        <div className="space-y-2">
          <p className="label !mb-0">
            Social profile URLs{' '}
            <span className="font-normal text-[hsl(var(--muted-foreground))]">
              (enter at least one — e.g. Instagram alone is enough)
            </span>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {SOCIAL_URL_FIELDS.map(({ key, label, placeholder }) => (
              <Field key={key} label={label}>
                <input
                  className="input"
                  type="url"
                  placeholder={placeholder}
                  value={form.socialUrls[key] || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      socialUrls: { ...form.socialUrls, [key]: e.target.value },
                    })
                  }
                />
              </Field>
            ))}
          </div>
        </div>

        <ProcessingButton
          onClick={add}
          disabled={!canSave}
          loading={adding}
          loadingText="Adding competitor…"
          variant="sector"
          icon={<Plus size={16} />}
          className="w-full sm:w-auto !min-h-[48px]"
        >
          Add competitor
        </ProcessingButton>
        {!canSave && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Enter a name and at least one social URL to enable save.
          </p>
        )}
      </SectionCard>

      <SectionCard
        icon={FileSpreadsheet}
        title="Bulk add competitors"
        description="One competitor per line, or upload Excel/CSV. Each row needs a name and at least one profile URL."
      >
        <Field label="Bulk list (comma-separated fields, one per line)">
          <textarea
            className="input min-h-[120px] resize-y font-mono text-xs sm:text-sm"
            placeholder={[
              'Acme Cloud, https://instagram.com/acmecloud',
              'Beta Labs, linkedin, https://linkedin.com/company/betalabs',
              'https://instagram.com/gamma, https://instagram.com/delta',
            ].join('\n')}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            disabled={bulkSaving || bulkUploading}
          />
        </Field>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <ProcessingButton
            onClick={() => void bulkAddText()}
            disabled={!bulkText.trim() || bulkUploading}
            loading={bulkSaving}
            loadingText="Adding…"
            variant="sector"
            icon={<Plus size={16} />}
            className="w-full sm:w-auto !min-h-[48px]"
          >
            Add all from text
          </ProcessingButton>
          <label
            className={`btn-sector-outline inline-flex cursor-pointer items-center justify-center gap-2 !min-h-[48px] ${
              bulkSaving || bulkUploading ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            {bulkUploading ? <Spinner size={15} /> : <Upload size={15} />}
            {bulkUploading ? 'Uploading…' : 'Upload Excel / CSV'}
            <input
              ref={bulkFileRef}
              type="file"
              accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              disabled={bulkSaving || bulkUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void bulkUploadFile(file);
              }}
            />
          </label>
          <a
            href="/api/settings/competitors/bulk/template.xlsx"
            className="btn-ghost inline-flex items-center justify-center gap-2 !min-h-[44px] text-sm"
          >
            <FileSpreadsheet size={15} />
            Download template
          </a>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Excel columns: <code className="text-[11px]">name</code>,{' '}
          <code className="text-[11px]">platform</code>,{' '}
          <code className="text-[11px]">instagram</code>,{' '}
          <code className="text-[11px]">linkedin</code>, etc. Duplicates are skipped.
        </p>
      </SectionCard>

      <div className="px-1">
        <p className="text-sm font-medium">Tracked competitors</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
          All profile links are listed below. Turn Scrape off to keep a competitor saved but skip it on scrape — Delete removes it.
        </p>
      </div>

      {okMsg && <InlineNotice kind="success">{okMsg}</InlineNotice>}
      {error && <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{error}</p>}

      {competitors.length === 0 ? (
        <EmptyList message="No competitors yet." />
      ) : (
        <div className="card !p-0 overflow-hidden">
          {competitors.map((c) => {
            const links = linksFor(c);
            return (
              <ListRow
                key={c.id}
                title={c.name}
                subtitle={`Primary: ${c.platform}${c.handle ? ` · @${c.handle.replace(/^@/, '')}` : ''}`}
                active={c.isActive !== false}
                activeLabel="Scrape"
                onToggleActive={async (next) => {
                  await api(`/settings/competitors/${c.id}`, {
                    method: 'PATCH',
                    body: { isActive: next },
                  });
                  setCompetitors((prev) =>
                    prev.map((row) => (row.id === c.id ? { ...row, isActive: next } : row)),
                  );
                  notifySuccess(next ? `“${c.name}” scrape on` : `“${c.name}” scrape paused`);
                }}
                onDelete={() => api(`/settings/competitors/${c.id}`, { method: 'DELETE' }).then(load)}
              >
                {links.length === 0 ? (
                  <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">No profile links saved</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {links.map((l) => (
                      <li key={`${c.id}-${l.key}`} className="flex items-start gap-2 text-xs min-w-0">
                        <span className="shrink-0 w-[4.5rem] font-medium text-[hsl(var(--muted-foreground))]">
                          {l.label}
                        </span>
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 break-all text-brand-700 underline-offset-2 hover:underline dark:text-brand-300 inline-flex items-start gap-1"
                        >
                          <span className="min-w-0">{l.url}</span>
                          <ExternalLink size={11} className="mt-0.5 shrink-0 opacity-70" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </ListRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlatformSettings() {
  const [connections, setConnections] = useState<Array<{
    id: string;
    platform: string;
    accountName: string;
    accountId?: string | null;
  }>>([]);
  const [form, setForm] = useState({ platform: 'instagram', accountName: '', accessToken: '', accountId: '' });
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = () => api<{ data: typeof connections }>('/settings/platforms').then((r) => setConnections(r.data));
  useEffect(() => { load(); }, []);

  const add = async () => {
    setAdding(true);
    try {
      await api('/settings/platforms', { method: 'POST', body: form });
      setForm({ platform: 'instagram', accountName: '', accessToken: '', accountId: '' });
      load();
      notifySuccess('Publishing account connected');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard icon={Share2} title="Connect account" description="Tokens used when publishing approved posts.">
        <Field label="Platform">
          <select className="input" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
            <option value="instagram">Instagram</option>
            <option value="linkedin">LinkedIn</option>
            <option value="facebook">Facebook</option>
            <option value="twitter">Twitter / X</option>
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account name">
            <input className="input" placeholder="Display name" value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} />
          </Field>
          <Field label="Account ID">
            <input
              className="input"
              placeholder={form.platform === 'instagram' ? 'Auto-detected from Meta token' : 'Platform account ID'}
              value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            />
          </Field>
        </div>
        {form.platform === 'instagram' && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Instagram Business/Creator ID is detected automatically from the linked Facebook Page.
            The token needs pages_show_list, pages_read_engagement, instagram_basic, and
            instagram_content_publish.
          </p>
        )}
        <Field label="Access token">
          <PasswordInput className="input" placeholder="Access token" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />
        </Field>
        <ProcessingButton
          onClick={add}
          disabled={!form.accountName || !form.accessToken}
          loading={adding}
          loadingText="Connecting…"
          variant="sector"
          className="w-full sm:w-auto !min-h-[48px]"
        >
          Connect
        </ProcessingButton>
      </SectionCard>

      {error && <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{error}</p>}

      <p className="text-sm font-medium px-1">Connected accounts</p>
      {connections.length === 0 ? (
        <EmptyList message="No publishing accounts connected." />
      ) : (
        <div className="card !p-0 overflow-hidden">
          {connections.map((c) => (
            <ListRow
              key={c.id}
              title={
                <span className="inline-flex items-center gap-2">
                  <PlatformBadge platform={c.platform} size="sm" />
                  <span className="font-medium">{c.accountName}</span>
                </span>
              }
              subtitle={c.accountId ? `Account ID ${c.accountId}` : 'Account ID missing'}
              onDelete={() => api(`/settings/platforms/${c.id}`, { method: 'DELETE' }).then(load)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type AutomationRow = {
  id: string;
  name: string | null;
  scheduleType: 'once' | 'weekly';
  scheduleSummary: string;
  timezone: string;
  jobType: 'newsletter' | 'competitor' | 'trends' | 'meme' | 'calendar';
  calendarMode?: 'saved_plan' | 'ai_plan' | 'uploaded_plan' | 'festival';
  contentCalendarPlanId?: string | null;
  contentCalendarPlanName?: string | null;
  calendarFilters?: {
    regions?: Array<'india' | 'gcc' | 'europe' | 'usa' | 'global'>;
    categories?: Array<'tech' | 'festival' | 'national' | 'observance'>;
  };
  templateMode: 'existing' | 'random' | 'none' | 'rotate';
  brandTemplateId: string | null;
  brandTemplateIds?: string[];
  rotateIncludeAi?: boolean;
  brandTemplate?: { id: string; name: string; provider: string } | null;
  documentMode?: 'fixed' | 'rotate' | 'none';
  libraryItemId?: string | null;
  visualMode?: 'existing_template' | 'ai' | 'ai_baked_layout';
  preferredFormatId?: string | null;
  contentSource?: 'product' | 'brand' | 'both';
  channels: string[];
  requireApproval: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

const JOB_LABELS: Record<AutomationRow['jobType'], string> = {
  newsletter: 'Product newsletter',
  competitor: 'Competitor scraping',
  trends: 'Trends',
  meme: 'Brand-safe meme',
  calendar: 'Content calendar',
};

const CALENDAR_MODE_LABELS: Record<NonNullable<AutomationRow['calendarMode']>, string> = {
  saved_plan: 'My content calendar',
  ai_plan: 'My content calendar',
  uploaded_plan: 'My content calendar',
  festival: 'Universal festival',
};

const FESTIVAL_REGION_OPTIONS = [
  { id: 'india' as const, label: 'India' },
  { id: 'gcc' as const, label: 'GCC' },
  { id: 'europe' as const, label: 'Europe' },
  { id: 'usa' as const, label: 'USA' },
  { id: 'global' as const, label: 'Global / Tech' },
];

const FESTIVAL_CATEGORY_OPTIONS = [
  { id: 'festival' as const, label: 'Festival' },
  { id: 'national' as const, label: 'National' },
  { id: 'observance' as const, label: 'Observance' },
  { id: 'tech' as const, label: 'Tech' },
];

const ALL_FESTIVAL_REGIONS = FESTIVAL_REGION_OPTIONS.map((o) => o.id);
const ALL_FESTIVAL_CATEGORIES = FESTIVAL_CATEGORY_OPTIONS.map((o) => o.id);

const WIZARD_STEPS = [
  { id: 1, label: 'Schedule' },
  { id: 2, label: 'What to run' },
  { id: 3, label: 'Template' },
  { id: 4, label: 'Channels' },
  { id: 5, label: 'Approval' },
] as const;

/** Curated IANA zones — browser zone is always prepended if missing. */
const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Riyadh', label: 'Riyadh (AST)' },
  { value: 'Asia/Qatar', label: 'Qatar' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Asia/Shanghai', label: 'Shanghai' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Europe/Berlin', label: 'Berlin / CET' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam' },
  { value: 'America/New_York', label: 'US Eastern' },
  { value: 'America/Chicago', label: 'US Central' },
  { value: 'America/Denver', label: 'US Mountain' },
  { value: 'America/Los_Angeles', label: 'US Pacific' },
  { value: 'America/Sao_Paulo', label: 'São Paulo' },
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'Pacific/Auckland', label: 'Auckland' },
  { value: 'UTC', label: 'UTC' },
];

function timezoneOffsetLabel(tz: string, at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
    }).formatToParts(at);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    return name || '';
  } catch {
    return '';
  }
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}

function normalizeHhMm(value: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return value.trim();
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return value.trim();
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function formatInTimeZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timeZone || undefined,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function TimezoneSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (tz: string) => void;
}) {
  const browser = browserTimeZone();
  const options = (() => {
    const base = [...COMMON_TIMEZONES];
    if (browser && !base.some((z) => z.value === browser)) {
      base.unshift({ value: browser, label: `${browser} (browser)` });
    }
    if (value && !base.some((z) => z.value === value)) {
      base.unshift({ value, label: value });
    }
    return base;
  })();

  return (
    <select
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Timezone"
    >
      {options.map((z) => {
        const off = timezoneOffsetLabel(z.value);
        return (
          <option key={z.value} value={z.value}>
            {z.label}
            {off ? ` · ${off}` : ''} · {z.value}
          </option>
        );
      })}
    </select>
  );
}

function AutomationSettings() {
  const [items, setItems] = useState<AutomationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [brandTemplates, setBrandTemplates] = useState<
    Array<{ id: string; name: string; provider: string; isActive?: boolean }>
  >([]);
  const [platforms, setPlatforms] = useState<Array<{ id: string; platform: string; accountName: string }>>([]);
  const [documents, setDocuments] = useState<Array<{ id: string; title: string }>>([]);

  const [scheduleType, setScheduleType] = useState<'once' | 'weekly'>('weekly');
  const [runAtLocal, setRunAtLocal] = useState('');
  const [weeklyDay, setWeeklyDay] = useState(1);
  const [weeklyTime, setWeeklyTime] = useState('09:00');
  const [timezone, setTimezone] = useState(browserTimeZone);
  const [jobType, setJobType] = useState<AutomationRow['jobType']>('newsletter');
  const [calendarMode, setCalendarMode] = useState<
    NonNullable<AutomationRow['calendarMode']>
  >('saved_plan');
  const [festivalRegions, setFestivalRegions] = useState<typeof ALL_FESTIVAL_REGIONS>([
    ...ALL_FESTIVAL_REGIONS,
  ]);
  const [festivalCategories, setFestivalCategories] = useState<typeof ALL_FESTIVAL_CATEGORIES>([
    ...ALL_FESTIVAL_CATEGORIES,
  ]);
  const [festivalFilterOpen, setFestivalFilterOpen] = useState(false);
  const [contentCalendarPlanId, setContentCalendarPlanId] = useState('');
  const [savedCalendarPlans, setSavedCalendarPlans] = useState<
    Array<{
      id: string;
      name: string;
      source: string;
      year: number;
      month: number;
      status: string;
      entryCount: number;
    }>
  >([]);
  const [templateMode, setTemplateMode] = useState<'existing' | 'random' | 'none' | 'rotate'>('none');
  const [brandTemplateId, setBrandTemplateId] = useState('');
  const [rotateTemplateIds, setRotateTemplateIds] = useState<string[]>([]);
  const [rotateIncludeAi, setRotateIncludeAi] = useState(false);
  const [documentMode, setDocumentMode] = useState<'fixed' | 'rotate'>('rotate');
  const [libraryItemId, setLibraryItemId] = useState('');
  const [memeContentSource, setMemeContentSource] = useState<'product' | 'brand' | 'both'>('both');
  const [memeVisualMode, setMemeVisualMode] = useState<'ai' | 'ai_baked_layout'>('ai');
  const [memePreferredFormatId, setMemePreferredFormatId] = useState('');
  const [memeMeta, setMemeMeta] = useState<{
    formats: Array<{ id: string; label: string; heat: number }>;
    hasBrandContext: boolean;
    websiteUrl: string;
  }>({ formats: [], hasBrandContext: false, websiteUrl: '' });
  const [channels, setChannels] = useState<string[]>([]);
  const [requireApproval, setRequireApproval] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [autos, tpls, plats, docs, plansRes, memes] = await Promise.all([
        api<{ data: AutomationRow[] }>('/automations'),
        api<{ data: typeof brandTemplates }>('/brand/templates').catch(() => ({ data: [] })),
        api<{ data: typeof platforms }>('/settings/platforms').catch(() => ({ data: [] })),
        api<{ data: Array<{ id: string; title: string }> }>('/settings/library').catch(() => ({ data: [] })),
        api<{
          data: {
            plans: Array<{
              id: string;
              name: string;
              source: string;
              year: number;
              month: number;
              status: string;
              _count?: { entries: number };
              entries?: unknown[];
            }>;
          };
        }>('/content/calendar/plan/saved').catch(() => ({ data: { plans: [] } })),
        api<{
          data: {
            formats: Array<{ id: string; label: string; heat: number }>;
            hasBrandContext: boolean;
            websiteUrl: string;
          };
        }>('/content/memes/meta').catch(() => ({
          data: { formats: [], hasBrandContext: false, websiteUrl: '' },
        })),
      ]);
      setMemeMeta({
        formats: memes.data?.formats || [],
        hasBrandContext: Boolean(memes.data?.hasBrandContext),
        websiteUrl: memes.data?.websiteUrl || '',
      });
      setItems(autos.data || []);
      const active = (tpls.data || []).filter((t) => t.isActive !== false);
      setBrandTemplates(active);
      setBrandTemplateId((prev) => prev || active[0]?.id || '');
      setRotateTemplateIds((prev) => (prev.length ? prev : active.map((t) => t.id)));
      setPlatforms(plats.data || []);
      setDocuments((docs.data || []).map((d) => ({ id: d.id, title: d.title })));
      setLibraryItemId((prev) => prev || docs.data?.[0]?.id || '');
      const plans = (plansRes.data?.plans || [])
        .filter((p) => p.status === 'active')
        .map((p) => ({
          id: p.id,
          name: p.name,
          source: p.source,
          year: p.year,
          month: p.month,
          status: p.status,
          entryCount: p._count?.entries ?? (Array.isArray(p.entries) ? p.entries.length : 0),
        }));
      setSavedCalendarPlans(plans);
      setContentCalendarPlanId((prev) => prev || plans[0]?.id || '');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load';
      setError(msg);
      notifyError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resetWizard = () => {
    setStep(1);
    setScheduleType('weekly');
    setRunAtLocal('');
    setWeeklyDay(1);
    setWeeklyTime('09:00');
    setTimezone(browserTimeZone());
    setJobType('newsletter');
    setCalendarMode('saved_plan');
    setFestivalRegions([...ALL_FESTIVAL_REGIONS]);
    setFestivalCategories([...ALL_FESTIVAL_CATEGORIES]);
    setFestivalFilterOpen(false);
    setContentCalendarPlanId(savedCalendarPlans[0]?.id || '');
    setTemplateMode('existing');
    setBrandTemplateId(brandTemplates[0]?.id || '');
    setRotateTemplateIds(brandTemplates.map((t) => t.id));
    setRotateIncludeAi(false);
    setDocumentMode('rotate');
    setLibraryItemId(documents[0]?.id || '');
    setMemeContentSource(documents.length ? 'both' : 'brand');
    setMemeVisualMode('ai');
    setMemePreferredFormatId('');
    setChannels([]);
    setRequireApproval(true);
    setError('');
  };

  const openWizard = () => {
    resetWizard();
    setWizardOpen(true);
  };

  /** Meme runs sourced only from website content skip the product-document step. */
  const memeNeedsProductDoc = () =>
    jobType === 'newsletter' || (jobType === 'meme' && memeContentSource !== 'brand');

  const canNext = () => {
    if (step === 1) {
      if (!timezone) return false;
      if (scheduleType === 'once') return Boolean(runAtLocal);
      return Boolean(weeklyTime);
    }
    if (step === 2) {
      if (jobType === 'calendar') {
        if (calendarMode === 'festival') {
          return festivalRegions.length > 0 && festivalCategories.length > 0;
        }
        if (calendarMode === 'saved_plan') {
          return Boolean(contentCalendarPlanId);
        }
        return Boolean(calendarMode);
      }
      return Boolean(jobType);
    }
    if (step === 3) {
      // Brand-template choice and product-doc choice are independent — both must pass.
      if (templateMode === 'existing' && !brandTemplateId) return false;
      if (templateMode === 'rotate' && !rotateTemplateIds.length && !rotateIncludeAi) return false;
      if (memeNeedsProductDoc()) {
        if (documents.length === 0) return false;
        if (documentMode === 'fixed' && !libraryItemId) return false;
      }
      if (jobType === 'meme' && memeContentSource !== 'product' && !memeMeta.hasBrandContext) {
        return false;
      }
      return true;
    }
    // Channels are optional until approval=No (validated on step 5 / create)
    return true;
  };

  const canCreate = () => {
    if (scheduleType === 'once' && !runAtLocal) return false;
    if (scheduleType === 'weekly' && !weeklyTime) return false;
    if (!timezone) return false;
    if (jobType === 'calendar') {
      if (calendarMode === 'festival' && (!festivalRegions.length || !festivalCategories.length)) {
        return false;
      }
      if (calendarMode === 'saved_plan' && !contentCalendarPlanId) return false;
    }
    if (templateMode === 'existing' && !brandTemplateId) return false;
    if (templateMode === 'rotate' && !rotateTemplateIds.length && !rotateIncludeAi) return false;
    if (
      memeNeedsProductDoc() &&
      (documents.length === 0 || (documentMode === 'fixed' && !libraryItemId))
    ) {
      return false;
    }
    if (jobType === 'meme' && memeContentSource !== 'product' && !memeMeta.hasBrandContext) {
      return false;
    }
    if (!requireApproval && channels.length === 0) return false;
    return true;
  };

  const toggleChannel = (platform: string) => {
    setChannels((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
    );
  };

  const create = async () => {
    if (!canCreate()) {
      setError(
        !requireApproval && channels.length === 0
          ? 'Select at least one channel for auto-publish, or choose Yes on approval.'
          : memeNeedsProductDoc() && documents.length === 0
            ? 'Upload a product document on the Newsletter page first.'
            : memeNeedsProductDoc() && documentMode === 'fixed' && !libraryItemId
              ? 'Pick a product document for Fixed mode.'
              : jobType === 'meme' &&
                  memeContentSource !== 'product' &&
                  !memeMeta.hasBrandContext
                ? 'No website content saved. Scrape your site in Settings → Company, or source the meme from a product document.'
                : 'Finish required fields in the earlier steps first.',
      );
      return;
    }
    setSaving(true);
    setError('');
    try {
      await withSaveFeedback(
        async () => {
          // Send naive wall-clock for once; backend interprets in `timezone`
          const needsProductDoc = memeNeedsProductDoc();
          const body = {
            scheduleType,
            runAt: scheduleType === 'once' && runAtLocal ? runAtLocal : null,
            weeklyDay: scheduleType === 'weekly' ? weeklyDay : null,
            weeklyTime: scheduleType === 'weekly' ? normalizeHhMm(weeklyTime) : null,
            timezone,
            jobType,
            calendarMode: jobType === 'calendar' ? calendarMode : undefined,
            calendarFilters:
              jobType === 'calendar' && calendarMode === 'festival'
                ? { regions: festivalRegions, categories: festivalCategories }
                : undefined,
            contentCalendarPlanId:
              jobType === 'calendar' && calendarMode === 'saved_plan'
                ? contentCalendarPlanId || null
                : undefined,
            templateMode,
            brandTemplateId: templateMode === 'existing' ? brandTemplateId : null,
            brandTemplateIds:
              templateMode === 'rotate'
                ? [
                    ...rotateTemplateIds,
                    ...(rotateIncludeAi ? (['__ai__'] as const) : []),
                  ]
                : templateMode === 'random'
                  ? rotateTemplateIds
                  : [],
            // Never send documentMode "none" — API only accepts fixed|rotate for newsletter/meme.
            // Other job types omit these fields; the server stores documentMode=none itself.
            ...(needsProductDoc
              ? {
                  documentMode,
                  libraryItemId: documentMode === 'fixed' ? libraryItemId || null : null,
                }
              : {}),
            ...(jobType === 'meme'
              ? {
                  contentSource: memeContentSource,
                  // A chosen brand template wins at run time; this is the AI fallback.
                  visualMode: templateMode === 'none' ? memeVisualMode : 'existing_template',
                  preferredFormatId: memePreferredFormatId || null,
                }
              : {}),
            channels,
            requireApproval,
          };
          await api('/automations', { method: 'POST', body });
          await load();
          setWizardOpen(false);
          resetWizard();
        },
        { success: 'Automation created', errorPrefix: "Couldn't create automation" },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const setEnabled = async (id: string, enabled: boolean) => {
    try {
      await withSaveFeedback(
        async () => {
          await api(`/automations/${id}`, { method: 'PATCH', body: { enabled } });
          await load();
        },
        { success: enabled ? 'Automation enabled' : 'Automation paused', errorPrefix: "Couldn't update" },
      );
    } catch {
      /* toast already shown */
    }
  };

  const runNow = async (id: string) => {
    setRunningId(id);
    try {
      await withSaveFeedback(
        async () => {
          await api(`/automations/${id}/run`, { method: 'POST' });
          await load();
        },
        { success: 'Automation run started — check Approvals', errorPrefix: "Couldn't run automation" },
      );
    } catch {
      /* toast already shown */
    } finally {
      setRunningId(null);
    }
  };

  const remove = async (id: string) => {
    try {
      await withSaveFeedback(
        async () => {
          await api(`/automations/${id}`, { method: 'DELETE' });
          await load();
        },
        { success: 'Automation deleted', errorPrefix: "Couldn't delete" },
      );
    } catch {
      /* toast already shown */
    }
  };

  const uniquePlatforms = Array.from(new Set(platforms.map((p) => p.platform)));

  return (
    <div className="space-y-4">
      <SectionCard
        icon={Workflow}
        title="Automation workflows"
        description="Schedule newsletter, competitor, trends, meme, or content calendar runs. Brand templates and publish channels are chosen here; competitor lists and topics stay in Settings; docs live on the Newsletter page; calendar ideas live on Content Calendar."
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Runs every minute when due · default timezone {timezone}
          </p>
          <ProcessingButton
            type="button"
            variant="sector"
            className="!min-h-[44px] !px-5 text-sm gap-1.5"
            onClick={openWizard}
            icon={<Plus size={15} />}
          >
            New automation
          </ProcessingButton>
        </div>
      </SectionCard>

      {wizardOpen && (
        <section className="settings-card space-y-5">
          <div className="flex items-start justify-between gap-3 pl-1">
            <div>
              <h3 className="font-semibold text-[15px]">Create automation</h3>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                Step {step} of {WIZARD_STEPS.length} — {WIZARD_STEPS[step - 1]?.label}
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost min-h-[44px] md:!min-h-[36px] !px-2 text-xs"
              onClick={() => {
                setWizardOpen(false);
                resetWizard();
              }}
            >
              Cancel
            </button>
          </div>

          <WorkflowStepper steps={WIZARD_STEPS} current={step} />

          <div key={step} className="workflow-stage min-w-0">
          {step === 1 && (
            <div className="space-y-4">
              <ChoiceCards
                value={scheduleType}
                onChange={setScheduleType}
                options={[
                  { id: 'once', label: 'One-time', hint: 'Specific date & time' },
                  { id: 'weekly', label: 'Recurring', hint: 'Same day & time each week' },
                ]}
              />
              {scheduleType === 'once' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Date & time">
                    <input
                      type="datetime-local"
                      className="input"
                      value={runAtLocal}
                      onChange={(e) => setRunAtLocal(e.target.value)}
                    />
                  </Field>
                  <Field label="Timezone">
                    <TimezoneSelect value={timezone} onChange={setTimezone} />
                  </Field>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Day of week">
                    <select
                      className="input"
                      value={weeklyDay}
                      onChange={(e) => setWeeklyDay(Number(e.target.value))}
                    >
                      {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                        (d, i) => (
                          <option key={d} value={i}>
                            {d}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                  <Field label="Time">
                    <input
                      type="time"
                      className="input"
                      value={weeklyTime}
                      onChange={(e) => setWeeklyTime(e.target.value)}
                    />
                  </Field>
                  <Field label="Timezone">
                    <TimezoneSelect value={timezone} onChange={setTimezone} />
                  </Field>
                </div>
              )}
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                Wall-clock times use{' '}
                <span className="font-medium text-[hsl(var(--foreground))]">{timezone}</span>
                {' '}(IANA). “09:00” means 9:00 am in that zone — not the server clock.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <ChoiceCards
                value={jobType}
                onChange={(id) => {
                  setJobType(id);
                  // Product docs only apply to newsletter/meme — keep a safe default ready.
                  if (id === 'newsletter' || id === 'meme') {
                    setDocumentMode((prev) => (prev === 'fixed' || prev === 'rotate' ? prev : 'rotate'));
                    setLibraryItemId((prev) => prev || documents[0]?.id || '');
                  }
                }}
                options={[
                  {
                    id: 'newsletter',
                    label: 'Product newsletter',
                    hint: 'Uses docs & formats from the Newsletter page',
                  },
                  {
                    id: 'competitor',
                    label: 'Competitor scraping',
                    hint: 'Uses Settings → Competitors + scrape mode',
                  },
                  {
                    id: 'trends',
                    label: 'Trends',
                    hint: 'Uses Settings → Topics + trends mode',
                  },
                  {
                    id: 'meme',
                    label: 'Brand-safe meme',
                    hint: 'On-brand humor from guidelines + rotating product docs',
                  },
                  {
                    id: 'calendar',
                    label: 'Content calendar',
                    hint: 'My saved plans or Universal festival calendar',
                  },
                ]}
              />
              {jobType === 'calendar' && (
                <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
                  <p className="text-sm font-medium">Which Content Calendar?</p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    My content calendar uses plans already saved on Content Calendar. Universal
                    festival asks for country and festival-type filters.
                  </p>
                  <ChoiceCards
                    value={
                      calendarMode === 'festival'
                        ? 'festival'
                        : 'saved_plan'
                    }
                    onChange={(id) => {
                      if (id === 'festival') {
                        setCalendarMode('festival');
                        setFestivalFilterOpen(true);
                      } else {
                        setCalendarMode('saved_plan');
                        setFestivalFilterOpen(false);
                        setContentCalendarPlanId(
                          (prev) => prev || savedCalendarPlans[0]?.id || '',
                        );
                      }
                    }}
                    options={[
                      {
                        id: 'saved_plan',
                        label: 'My content calendar',
                        hint: 'Already saved calendar plan — next AI or uploaded idea',
                      },
                      {
                        id: 'festival',
                        label: 'Universal festival content calendar',
                        hint: 'Catalog — pick country + festival type filters',
                      },
                    ]}
                  />
                  {calendarMode === 'festival' && (
                    <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          Filters ·{' '}
                          <span className="font-medium text-[hsl(var(--foreground))]">
                            {festivalRegions
                              .map(
                                (r) =>
                                  FESTIVAL_REGION_OPTIONS.find((o) => o.id === r)?.label || r,
                              )
                              .join(', ') || 'none'}
                          </span>
                          {' · '}
                          <span className="font-medium text-[hsl(var(--foreground))]">
                            {festivalCategories
                              .map(
                                (c) =>
                                  FESTIVAL_CATEGORY_OPTIONS.find((o) => o.id === c)?.label || c,
                              )
                              .join(', ') || 'none'}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="btn-ghost min-h-[44px] md:!min-h-[32px] !px-2 text-[11px] font-medium text-sky-700 dark:text-sky-300"
                          onClick={() => setFestivalFilterOpen(true)}
                        >
                          Edit filters
                        </button>
                      </div>
                    </div>
                  )}
                  {(calendarMode === 'saved_plan' ||
                    calendarMode === 'ai_plan' ||
                    calendarMode === 'uploaded_plan') && (
                    <div className="space-y-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-3">
                      <p className="text-sm font-medium">Which saved content calendar?</p>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                        Choose exactly one plan from Content Calendar. Automation runs the next
                        ready idea from that plan only.
                      </p>
                      {savedCalendarPlans.length === 0 ? (
                        <p className="text-sm text-amber-700 dark:text-amber-300">
                          No saved calendars yet — open Content Calendar, create or upload a plan,
                          then come back.
                        </p>
                      ) : (
                        <select
                          className="input"
                          value={contentCalendarPlanId}
                          onChange={(e) => setContentCalendarPlanId(e.target.value)}
                          aria-label="Saved content calendar"
                        >
                          {savedCalendarPlans.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · {p.year}-{String(p.month).padStart(2, '0')} ·{' '}
                              {p.source === 'ai' ? 'AI' : 'Upload'} · {p.entryCount} ideas
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              )}
              <InlineNotice>
                Competitor lists and topics live in Settings; product docs are on the Newsletter page.
                Content calendar ideas and month plans live on the Content Calendar page. Meme runs use
                brand voice + docs — always review before publish.
              </InlineNotice>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <ChoiceCards
                value={templateMode}
                onChange={(mode) => {
                  setTemplateMode(mode);
                  if (mode === 'rotate' && !rotateTemplateIds.length && brandTemplates.length) {
                    setRotateTemplateIds(brandTemplates.map((t) => t.id));
                  }
                }}
                options={[
                  { id: 'none', label: 'No template', hint: 'AI image (± logo) — not forced to Placid' },
                  { id: 'existing', label: 'Fixed template', hint: 'Always the same Brand Studio / Placid plate' },
                  { id: 'random', label: 'Random', hint: 'Pick any active template each run' },
                  { id: 'rotate', label: 'Rotate', hint: 'Cycle selected templates (+ optional AI)' },
                ]}
              />
              {templateMode === 'existing' && (
                <Field label="Brand template">
                  {brandTemplates.length === 0 ? (
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">
                      No templates yet — create one in Brand Studio (in-house or Placid).
                    </p>
                  ) : (
                    <select
                      className="input"
                      value={brandTemplateId}
                      onChange={(e) => setBrandTemplateId(e.target.value)}
                    >
                      {brandTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.provider === 'placid' ? 'Placid' : 'In-house'})
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              {templateMode === 'rotate' && (
                <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">Rotate pool</p>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                        Pick which saved templates to cycle — applies to every workflow. Optionally
                        include full AI generation (no Brand Studio plate) in the rotation.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="btn-ghost min-h-[44px] md:!min-h-[32px] !px-2 text-[11px]"
                        onClick={() => setRotateTemplateIds(brandTemplates.map((t) => t.id))}
                        disabled={!brandTemplates.length}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="btn-ghost min-h-[44px] md:!min-h-[32px] !px-2 text-[11px]"
                        onClick={() => setRotateTemplateIds([])}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {brandTemplates.length === 0 ? (
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">
                      No saved templates yet — enable Entire AI generation below, or create templates
                      in Brand Studio.
                    </p>
                  ) : (
                    <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                      {brandTemplates.map((t) => {
                        const active = rotateTemplateIds.includes(t.id);
                        return (
                          <label
                            key={t.id}
                            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
                              active
                                ? 'border-slate-900 bg-slate-900/5 dark:border-slate-100 dark:bg-slate-100/10'
                                : 'border-[hsl(var(--border))] hover:border-slate-400'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="size-4 accent-slate-900 dark:accent-slate-100"
                              checked={active}
                              onChange={() => {
                                setRotateTemplateIds((prev) =>
                                  active ? prev.filter((id) => id !== t.id) : [...prev, t.id],
                                );
                              }}
                            />
                            <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                              {t.provider === 'placid' ? 'Placid' : 'In-house'}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors ${
                      rotateIncludeAi
                        ? 'border-sky-600/50 bg-sky-500/10'
                        : 'border-[hsl(var(--border))] hover:border-slate-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-sky-600"
                      checked={rotateIncludeAi}
                      onChange={(e) => setRotateIncludeAi(e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">Entire AI generation</span>
                      <span className="mt-0.5 block text-[11px] text-[hsl(var(--muted-foreground))]">
                        Include a full AI image run (no Brand Studio / Placid plate) in the rotation
                        cycle alongside your selected templates.
                      </span>
                    </span>
                  </label>

                  {!rotateTemplateIds.length && !rotateIncludeAi && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Select at least one template or Entire AI generation to continue.
                    </p>
                  )}
                </div>
              )}
              {jobType === 'calendar' && (
                <InlineNotice>
                  {calendarMode === 'festival'
                    ? 'Generates a post for the next upcoming festival matching your country and type filters.'
                    : 'Runs the next manual/failed idea from a saved content calendar plan (AI or upload).'}{' '}
                  Month-plan automatic dates still fire from the Content Calendar page schedule.
                </InlineNotice>
              )}
              {jobType === 'meme' && (
                <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-3">
                  <p className="text-sm font-medium">Meme content</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    Each run picks a trending meme for your markets and reproduces its layout,
                    panel split and caption rhythm with original art. Choose where the facts of the
                    joke come from.
                  </p>
                  <ChoiceCards
                    value={memeContentSource}
                    onChange={(v) => setMemeContentSource(v as 'product' | 'brand' | 'both')}
                    options={[
                      {
                        id: 'product',
                        label: 'Product document',
                        hint: 'Facts strictly from the document chosen below',
                      },
                      {
                        id: 'brand',
                        label: 'Website content',
                        hint: memeMeta.websiteUrl
                          ? `Scraped from ${memeMeta.websiteUrl}`
                          : 'Voice, audience and guidelines from Settings → Company',
                      },
                      {
                        id: 'both',
                        label: 'Both',
                        hint: 'Product facts, framed in your website voice',
                      },
                    ]}
                  />
                  {memeContentSource !== 'product' && !memeMeta.hasBrandContext && (
                    <InlineNotice kind="error">
                      No website content saved yet — scrape your site in Settings → Company, or
                      source the meme from a product document.
                    </InlineNotice>
                  )}
                  {templateMode === 'none' && (
                    <>
                      <p className="text-sm font-medium">AI creative</p>
                      <ChoiceCards
                        value={memeVisualMode}
                        onChange={(v) => setMemeVisualMode(v as 'ai' | 'ai_baked_layout')}
                        options={[
                          {
                            id: 'ai',
                            label: 'AI LLM',
                            hint: 'AI art matched to the meme + crisp caption overlay',
                          },
                          {
                            id: 'ai_baked_layout',
                            label: 'Only AI painter',
                            hint: 'One painted image with the text baked in',
                          },
                        ]}
                      />
                    </>
                  )}
                  {templateMode !== 'none' && (
                    <InlineNotice>
                      Your brand template (in-house or Placid) is used for the artwork, still locked
                      to the trending meme&apos;s structure.
                    </InlineNotice>
                  )}
                  {memeMeta.formats.length > 0 && (
                    <Field label="Force meme format (optional)">
                      <select
                        className="input"
                        value={memePreferredFormatId}
                        onChange={(e) => setMemePreferredFormatId(e.target.value)}
                      >
                        <option value="">Auto — read from the trending meme each run</option>
                        {memeMeta.formats.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label} (heat {f.heat})
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>
              )}
              {memeNeedsProductDoc() && (
                <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-3">
                  <p className="text-sm font-medium">Product documents</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    Uses documents uploaded on the Newsletter page. A document counts as used only
                    after the post is approved and published to social media — then rotation advances.
                    Every run still writes a fresh style variation from the same product facts.
                  </p>
                  {documents.length === 0 ? (
                    <InlineNotice kind="error">
                      Upload at least one product document on the Newsletter page before creating
                      this automation.
                    </InlineNotice>
                  ) : (
                    <>
                      <ChoiceCards
                        value={documentMode}
                        onChange={(v) => setDocumentMode(v as 'fixed' | 'rotate')}
                        options={[
                          {
                            id: 'rotate',
                            label: 'Rotate product documents',
                            hint: `Cycle ${documents.length} saved doc${documents.length === 1 ? '' : 's'} in order · next only after publish · then restart`,
                          },
                          {
                            id: 'fixed',
                            label: 'Fixed product document',
                            hint: 'Always the document you pick below · new newsletter style each run',
                          },
                        ]}
                      />
                      {documentMode === 'rotate' && (
                        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2">
                          <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
                            Rotation order (oldest first → newest)
                          </p>
                          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-[hsl(var(--foreground))]">
                            {documents.map((d) => (
                              <li key={d.id} className="truncate">
                                {d.title}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                      {documentMode === 'fixed' && (
                        <Field label="Choose product document">
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
                        </Field>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3 animate-stage-in">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Choose connected publish channels. Connect more under Settings → Publish.
                {jobType === 'competitor' && (
                  <>
                    {' '}
                    For <strong className="text-[hsl(var(--foreground))]">Competitor scraping</strong>,
                    selected channels also control which networks are scraped that run (e.g. Instagram
                    only → scrape Instagram only).
                  </>
                )}
              </p>
              {uniquePlatforms.length === 0 ? (
                <EmptyList message="No publishing accounts connected." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {uniquePlatforms.map((platform, index) => {
                    const active = channels.includes(platform);
                    const accounts = platforms.filter((p) => p.platform === platform);
                    return (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => toggleChannel(platform)}
                        aria-pressed={active}
                        className="channel-pick"
                        style={{ animationDelay: `${index * 40}ms` }}
                      >
                        <span className="channel-pick-glow" aria-hidden="true" />
                        <div className="relative flex items-start justify-between gap-3">
                          <div className="min-w-0 flex items-start gap-3">
                            <span
                              className={`mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-all duration-300 ${
                                active
                                  ? 'scale-105 shadow-sm'
                                  : 'opacity-90'
                              }`}
                              aria-hidden="true"
                            >
                              <PlatformBadge platform={platform} variant="icon" size="lg" />
                            </span>
                            <div className="min-w-0">
                              <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                                <PlatformBadge platform={platform} size="sm" variant="ghost" />
                              </span>
                              <p className="mt-0.5 text-[11px] leading-snug text-[hsl(var(--muted-foreground))] truncate">
                                {accounts.map((a) => a.accountName).join(', ')}
                              </p>
                              <p
                                className={`mt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-all duration-300 ${
                                  active
                                    ? 'text-brand-600 opacity-100 translate-y-0'
                                    : 'text-[hsl(var(--muted-foreground))] opacity-0 -translate-y-1'
                                }`}
                              >
                                Selected
                              </p>
                            </div>
                          </div>
                          <span
                            className={`relative grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-all duration-300 ${
                              active
                                ? 'border-brand-600 bg-brand-600 text-white'
                                : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-transparent'
                            }`}
                            aria-hidden="true"
                          >
                            {active ? (
                              <Check size={14} strokeWidth={2.5} className="animate-check-pop" />
                            ) : (
                              <span className="block h-2 w-2 rounded-full bg-[hsl(var(--border))]" />
                            )}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {channels.length > 0 && (
                <p className="text-xs text-[hsl(var(--muted-foreground))] animate-fade-in">
                  {channels.length} channel{channels.length === 1 ? '' : 's'} selected
                  <span className="mx-1.5 text-[hsl(var(--border))]">·</span>
                  <span className="capitalize">{channels.join(', ')}</span>
                </p>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <p className="text-sm font-medium">Human approval before posting needed?</p>
              <ChoiceCards
                value={requireApproval ? 'yes' : 'no'}
                onChange={(v) => setRequireApproval(v === 'yes')}
                options={[
                  {
                    id: 'yes',
                    label: 'Yes',
                    hint: 'Generate → land in Approvals (pending). No auto-post.',
                  },
                  {
                    id: 'no',
                    label: 'No',
                    hint: 'After generation, publish to chosen channels automatically.',
                  },
                ]}
              />
              {!requireApproval && channels.length === 0 && (
                <InlineNotice kind="error">
                  Select at least one channel in the previous step to auto-publish.
                </InlineNotice>
              )}
            </div>
          )}
          </div>

          {error && <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{error}</p>}

          <div className="mobile-action-bar">
            <ProcessingButton
              type="button"
              variant="sector-outline"
              className="!min-h-[44px] !px-4 text-sm gap-1"
              disabled={step <= 1 || saving}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              icon={<ChevronLeft size={16} />}
            >
              Back
            </ProcessingButton>
            {step < 5 ? (
              <ProcessingButton
                type="button"
                variant="sector"
                className="!min-h-[44px] !px-5 text-sm gap-1"
                disabled={!canNext() || saving}
                onClick={() => {
                  setError('');
                  setStep((s) => Math.min(5, s + 1));
                }}
              >
                Next <ChevronRight size={16} />
              </ProcessingButton>
            ) : (
              <ProcessingButton
                type="button"
                variant="sector"
                className="!min-h-[44px] !px-5 text-sm"
                loading={saving}
                loadingText="Creating…"
                disabled={!canCreate() || saving}
                onClick={() => void create()}
              >
                Create automation
              </ProcessingButton>
            )}
          </div>
        </section>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium px-1">Saved automations</p>
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner size={22} />
          </div>
        ) : items.length === 0 ? (
          <EmptyList message="No automations yet — create one with the wizard above." />
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="card !p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {item.name || JOB_LABELS[item.jobType] || item.jobType}
                    </p>
                    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
                      <Clock size={12} /> {item.scheduleSummary}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <ProcessingButton
                      type="button"
                      variant="sector-outline"
                      className="!min-h-[44px] md:!min-h-[36px] !px-3 text-xs"
                      loading={runningId === item.id}
                      loadingText="Running…"
                      disabled={runningId != null}
                      onClick={() => void runNow(item.id)}
                    >
                      Run now
                    </ProcessingButton>
                    <button
                      type="button"
                      className="btn-ghost min-h-[44px] md:!min-h-[36px] !px-2 text-slate-700 dark:text-slate-200"
                      aria-label="Delete automation"
                      onClick={() => void remove(item.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="chip min-h-[44px] md:!min-h-[28px] !px-2.5 !text-[11px]">
                    {JOB_LABELS[item.jobType] || item.jobType}
                  </span>
                  {item.jobType === 'calendar' && (
                    <span className="chip min-h-[44px] md:!min-h-[28px] !px-2.5 !text-[11px]">
                      {CALENDAR_MODE_LABELS[item.calendarMode || 'festival']}
                      {item.calendarMode === 'festival' &&
                      (item.calendarFilters?.regions?.length ||
                        item.calendarFilters?.categories?.length)
                        ? ` · ${(item.calendarFilters?.regions || [])
                            .map(
                              (r) =>
                                FESTIVAL_REGION_OPTIONS.find((o) => o.id === r)?.label || r,
                            )
                            .join('/') || 'all'} / ${(item.calendarFilters?.categories || [])
                            .map(
                              (c) =>
                                FESTIVAL_CATEGORY_OPTIONS.find((o) => o.id === c)?.label || c,
                            )
                            .join('/') || 'all'}`
                        : ''}
                      {(item.calendarMode === 'saved_plan' ||
                        item.calendarMode === 'ai_plan' ||
                        item.calendarMode === 'uploaded_plan') &&
                      (item.contentCalendarPlanName || item.contentCalendarPlanId)
                        ? ` · ${
                            item.contentCalendarPlanName ||
                            savedCalendarPlans.find((p) => p.id === item.contentCalendarPlanId)
                              ?.name ||
                            item.contentCalendarPlanId!.slice(0, 8)
                          }`
                        : ''}
                    </span>
                  )}
                  <span className="chip min-h-[44px] md:!min-h-[28px] !px-2.5 !text-[11px]">
                    Template:{' '}
                    {item.templateMode === 'none'
                      ? 'None (AI image)'
                      : item.templateMode === 'random'
                        ? 'Random'
                        : item.templateMode === 'rotate'
                          ? `Rotate · ${Math.max(
                              0,
                              (item.brandTemplateIds || []).filter((id) => id !== '__ai__').length,
                            )} tpl${
                              item.rotateIncludeAi || (item.brandTemplateIds || []).includes('__ai__')
                                ? ' + AI'
                                : ''
                            }`
                          : item.brandTemplate?.name || 'Existing'}
                  </span>
                  {item.channels.length ? (
                    <span className="inline-flex min-h-[44px] items-center md:!min-h-[28px]">
                      <PlatformBadgeList platforms={item.channels} size="sm" />
                    </span>
                  ) : (
                    <span className="chip min-h-[44px] md:!min-h-[28px] !px-2.5 !text-[11px]">
                      No channels
                    </span>
                  )}
                  <span className="chip min-h-[44px] md:!min-h-[28px] !px-2.5 !text-[11px]">
                    {item.requireApproval ? 'Needs approval' : 'Auto-publish'}
                  </span>
                  <span className="chip min-h-[44px] md:!min-h-[28px] !px-2.5 !text-[11px]">
                    {item.timezone || 'UTC'}
                  </span>
                </div>
                {item.nextRunAt && (
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    Next run · {formatInTimeZone(item.nextRunAt, item.timezone)}
                    {item.lastRunAt
                      ? ` · Last · ${formatInTimeZone(item.lastRunAt, item.timezone)}`
                      : ''}
                  </p>
                )}
                <Toggle
                  label={item.enabled ? 'Enabled' : 'Disabled'}
                  description={item.enabled ? 'Will run when due' : 'Paused'}
                  checked={item.enabled}
                  onCheckedChange={(checked) => void setEnabled(item.id, checked)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {festivalFilterOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/50 p-4 backdrop-blur-[2px] sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="festival-filter-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setFestivalFilterOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-2xl animate-scale-in">
            <p id="festival-filter-title" className="text-base font-semibold">
              Universal festival filters
            </p>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Same filters as Content Calendar → Universal festival calendar. Pick country/market and
              festival type.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  Country / market
                </p>
                <div className="flex flex-wrap gap-2">
                  {FESTIVAL_REGION_OPTIONS.map((opt) => {
                    const active = festivalRegions.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setFestivalRegions((prev) => {
                            if (active) {
                              if (prev.length <= 1) return prev;
                              return prev.filter((id) => id !== opt.id);
                            }
                            return [...prev, opt.id];
                          });
                        }}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                            : 'border-[hsl(var(--border))] bg-transparent text-[hsl(var(--foreground))] hover:border-slate-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  Festival type
                </p>
                <div className="flex flex-wrap gap-2">
                  {FESTIVAL_CATEGORY_OPTIONS.map((opt) => {
                    const active = festivalCategories.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setFestivalCategories((prev) => {
                            if (active) {
                              if (prev.length <= 1) return prev;
                              return prev.filter((id) => id !== opt.id);
                            }
                            return [...prev, opt.id];
                          });
                        }}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                            : 'border-[hsl(var(--border))] bg-transparent text-[hsl(var(--foreground))] hover:border-slate-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn-ghost min-h-[44px] px-4"
                onClick={() => {
                  setFestivalRegions([...ALL_FESTIVAL_REGIONS]);
                  setFestivalCategories([...ALL_FESTIVAL_CATEGORIES]);
                }}
              >
                Reset all
              </button>
              <button
                type="button"
                className="btn-primary min-h-[44px] min-w-[96px] px-5"
                onClick={() => setFestivalFilterOpen(false)}
                disabled={!festivalRegions.length || !festivalCategories.length}
              >
                Apply filters
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

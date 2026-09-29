'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useAuth, type CompanySummary } from '@/lib/auth-context';
import { ProcessingButton } from '@/components/ui';
import { notifyError, notifySuccess } from '@/lib/toast';
import clsx from 'clsx';

function slugPreview(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function CompanySwitcher({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { user, companies, switchCompany, createCompany } = useAuth();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const active = useMemo(() => {
    return (
      companies.find((c) => c.id === user?.tenantId) ||
      ({
        id: user?.tenantId || '',
        name: user?.tenantName || user?.companyName || 'Company',
        slug: user?.tenantSlug || '',
        role: user?.role || 'admin',
        companyName: user?.companyName || user?.tenantName || 'Company',
        isActive: true,
      } satisfies CompanySummary)
    );
  }, [companies, user]);

  useEffect(() => {
    if (!open) {
      setAdding(false);
      setName('');
      setSlug('');
    }
  }, [open]);

  if (!user) return null;

  const onSwitch = async (tenantId: string) => {
    if (tenantId === user.tenantId) {
      setOpen(false);
      return;
    }
    setSwitchingId(tenantId);
    try {
      await switchCompany(tenantId);
      notifySuccess('Switched company');
      setOpen(false);
      window.location.assign('/dashboard');
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Could not switch company');
    } finally {
      setSwitchingId(null);
    }
  };

  const onCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createCompany(name.trim(), slug.trim() || undefined);
      notifySuccess(`Opened ${name.trim()}`);
      setOpen(false);
      // One-time Identity scrape prompt for the new company
      window.location.assign('/settings?scrapePrompt=1');
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Could not create company');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex w-full items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-left transition-all hover:border-brand-500/40 hover:shadow-sm',
          compact ? 'min-h-[44px] px-2.5 py-2' : 'min-h-[48px] px-3 py-2.5',
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600/10 text-brand-700 dark:text-brand-300">
          <Building2 size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight">
            {active.companyName || active.name}
          </span>
          {!compact && (
            <span className="block truncate text-[11px] text-[hsl(var(--muted-foreground))]">
              {active.slug || 'Active company'}
            </span>
          )}
        </span>
        <ChevronsUpDown size={15} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close company menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl animate-scale-in">
            <div className="max-h-64 overflow-y-auto p-1.5">
              <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Companies
              </p>
              {companies.length === 0 ? (
                <p className="px-2 py-2 text-xs text-[hsl(var(--muted-foreground))]">No companies yet</p>
              ) : (
                companies.map((c) => {
                  const selected = c.id === user.tenantId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={switchingId === c.id}
                      onClick={() => void onSwitch(c.id)}
                      className={clsx(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                        selected
                          ? 'bg-brand-600/10 text-brand-800 dark:text-brand-200'
                          : 'hover:bg-[hsl(var(--muted))]',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.companyName || c.name}</span>
                        <span className="block truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                          {c.slug} · {c.role}
                        </span>
                      </span>
                      {selected && <Check size={14} className="shrink-0 text-brand-600" />}
                    </button>
                  );
                })
              )}
            </div>

            <div className="border-t border-[hsl(var(--border))] p-2">
              {!adding ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-500/10 dark:text-brand-300"
                  onClick={() => setAdding(true)}
                >
                  <Plus size={15} />
                  Add company
                </button>
              ) : (
                <div className="space-y-2 p-1">
                  <input
                    className="input min-h-[44px] md:!min-h-[40px] text-sm"
                    placeholder="Company name (e.g. Hyperthinks.ai)"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!slug || slug === slugPreview(name)) {
                        setSlug(slugPreview(e.target.value));
                      }
                    }}
                    autoFocus
                  />
                  <input
                    className="input min-h-[44px] md:!min-h-[40px] text-sm"
                    placeholder="slug (optional)"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  />
                  <div className="flex gap-2">
                    <ProcessingButton
                      className="flex-1 min-h-[44px] md:!min-h-[40px] text-xs"
                      loading={saving}
                      loadingText="Creating…"
                      onClick={() => void onCreate()}
                      disabled={!name.trim()}
                    >
                      Create & open
                    </ProcessingButton>
                    <button
                      type="button"
                      className="btn-ghost min-h-[44px] md:!min-h-[40px] text-xs"
                      onClick={() => setAdding(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

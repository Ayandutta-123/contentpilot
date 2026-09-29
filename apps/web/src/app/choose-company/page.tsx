'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Plus, Sparkles } from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';
import { useAuth } from '@/lib/auth-context';
import { ProcessingButton, InlineNotice } from '@/components/ui';
import { notifyError, notifySuccess } from '@/lib/toast';
import { APP_NAME } from '@/lib/brand';

export default function ChooseCompanyPage() {
  const { user, companies, switchCompany, createCompany, loading } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && user && companies.length === 1 && !user.needsCompanyChoice) {
      router.replace('/dashboard');
    }
  }, [loading, user, companies, router]);

  const openCompany = async (tenantId: string) => {
    setBusyId(tenantId);
    setError('');
    try {
      await switchCompany(tenantId);
      notifySuccess('Company opened');
      window.location.assign('/dashboard');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not open company';
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyId(null);
    }
  };

  const onCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await createCompany(name.trim(), slug.trim() || undefined);
      notifySuccess(`Created ${name.trim()}`);
      window.location.assign('/settings?scrapePrompt=1');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not create company';
      setError(msg);
      notifyError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthGuard>
      <div className="mx-auto flex min-h-[70vh] w-full max-w-3xl flex-col justify-center px-4 py-10 animate-page-enter">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
            <Sparkles size={22} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Choose a company</h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            {APP_NAME} keeps each company’s settings, calendar, newsletter, and logs separate.
          </p>
        </div>

        {error && (
          <div className="mb-4">
            <InlineNotice kind="error">{error}</InlineNotice>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busyId === c.id}
              onClick={() => void openCompany(c.id)}
              className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-md active:scale-[0.99]"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/10 text-brand-700 dark:text-brand-300">
                <Building2 size={18} />
              </span>
              <p className="mt-3 text-base font-semibold">{c.companyName || c.name}</p>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                {c.slug} · {c.role}
              </p>
              <p className="mt-4 text-sm font-medium text-brand-700 dark:text-brand-300">
                {busyId === c.id ? 'Opening…' : 'Continue →'}
              </p>
            </button>
          ))}

          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.25)] p-5">
            {!adding ? (
              <button
                type="button"
                className="flex h-full min-h-[140px] w-full flex-col items-start justify-center text-left"
                onClick={() => setAdding(true)}
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
                  <Plus size={18} />
                </span>
                <p className="mt-3 text-base font-semibold">Add company</p>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                  e.g. Arisio or Hyperthinks.ai — fresh settings & workflows
                </p>
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-semibold">New company</p>
                <input
                  className="input"
                  placeholder="Company name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
                <input
                  className="input"
                  placeholder="slug (optional)"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                />
                <ProcessingButton
                  className="w-full"
                  loading={saving}
                  loadingText="Creating…"
                  disabled={!name.trim()}
                  onClick={() => void onCreate()}
                >
                  Create & open
                </ProcessingButton>
              </div>
            )}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { PasswordInput } from '@/components/password-input';
import { APP_NAME, APP_TAGLINE } from '@/lib/brand';
import { InlineNotice, LoadingState, ProcessingButton } from '@/components/ui';
import { ArrowRight, Sparkles } from 'lucide-react';

export default function LoginPage() {
  const { login, user, loading, refresh } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    if (user.needsCompanyChoice || (user.companies && user.companies.length > 1 && !user.tenantId)) {
      router.replace('/choose-company');
      return;
    }
    router.replace('/dashboard');
  }, [loading, user, router]);

  if (loading || user) {
    return <LoadingState fullScreen title="Opening ContentPilot" description="Taking you to your workspace…" />;
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    try {
      if (mode === 'login') {
        const slug = String(fd.get('tenantSlug') || '').trim();
        const next = await login(
          fd.get('email') as string,
          fd.get('password') as string,
          slug || undefined,
        );
        if (next.needsCompanyChoice) {
          router.push('/choose-company');
        } else {
          router.push('/dashboard');
        }
      } else {
        await api('/auth/register', {
          method: 'POST',
          body: {
            tenantName: fd.get('tenantName'),
            tenantSlug: String(fd.get('tenantSlug') || '').trim() || undefined,
            email: fd.get('email'),
            password: fd.get('password'),
            name: fd.get('name'),
          },
        });
        await refresh();
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-8 pt-[max(2rem,env(safe-area-inset-top,0px))] pb-[max(2rem,env(safe-area-inset-bottom,0px))]">
      <div className="pointer-events-none absolute -left-32 -top-32 h-80 w-80 rounded-full bg-brand-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />
      <div className="card relative mx-auto w-full max-w-md !p-5 shadow-xl shadow-slate-950/5 sm:!p-8">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/25">
            <Sparkles size={22} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-600">{APP_NAME}</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            {APP_TAGLINE}
          </p>
        </div>

        <div className="segmented mb-6">
          <button
            type="button"
            onClick={() => setMode('login')}
            className="segmented-item"
            data-active={mode === 'login' ? 'true' : 'false'}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className="segmented-item"
            data-active={mode === 'register' ? 'true' : 'false'}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <>
              <div>
                <label className="label">Company name</label>
                <input name="tenantName" className="input" placeholder="Hyperthinks.ai" required />
              </div>
              <div>
                <label className="label">Your Name</label>
                <input name="name" className="input" required />
              </div>
            </>
          )}
          <div>
            <label className="label">
              Company slug {mode === 'login' ? '(optional)' : '(optional)'}
            </label>
            <input
              name="tenantSlug"
              className="input"
              placeholder="hyperthinks"
              pattern="[a-z0-9-]*"
            />
            <p className="helper-text mt-1">
              {mode === 'login'
                ? 'Leave blank to pick from your companies after sign-in.'
                : 'Auto-generated from the company name if empty.'}
            </p>
          </div>
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" className="input" required />
          </div>
          <div>
            <label className="label">Password</label>
            <PasswordInput name="password" className="input" minLength={8} required />
          </div>

          {error && <InlineNotice kind="error">{error}</InlineNotice>}

          <ProcessingButton
            type="submit"
            loading={submitting}
            loadingText={mode === 'login' ? 'Signing in…' : 'Creating workspace…'}
            className="w-full"
            icon={<ArrowRight size={17} />}
          >
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </ProcessingButton>
        </form>
      </div>
    </div>
  );
}

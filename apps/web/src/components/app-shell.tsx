'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CheckCircle, Settings, RotateCcw,
  FileText, LogOut, Moon, Sun, Menu, X, Sparkles, Newspaper, MessageSquare, Radar, CalendarDays, Mail, Laugh, Layers, Plus,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { NotificationBell } from '@/components/notification-bell';
import { CompanySwitcher } from '@/components/company-switcher';
import { APP_NAME, APP_TAGLINE } from '@/lib/brand';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { BackButton, Spinner } from '@/components/ui';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/trends', label: 'Trends', icon: Newspaper },
  { href: '/memes', label: 'Memes', icon: Laugh },
  { href: '/carousel', label: 'Carousel', icon: Layers },
  { href: '/competitors', label: 'Competitor Monitor', icon: Radar },
  { href: '/newsletter', label: 'Newsletter', icon: Mail },
  { href: '/calendar', label: 'Content Calendar', icon: CalendarDays },
  { href: '/brand-studio', label: 'Brand Studio', icon: Sparkles },
  { href: '/ai-assistant', label: 'AI Assistant', icon: MessageSquare },
  { href: '/approvals', label: 'Approvals', icon: CheckCircle },
  { href: '/rotation', label: 'Rotation', icon: RotateCcw },
  { href: '/logs', label: 'Logs', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const MOBILE_DOCK = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '__create__', label: 'Create', icon: Plus },
  { href: '/approvals', label: 'Approvals', icon: CheckCircle },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

const CREATE_SHEET_ITEMS = [
  { href: '/trends', label: 'Trends', hint: 'News → social post', icon: Newspaper },
  { href: '/memes', label: 'Memes', hint: 'Match viral formats', icon: Laugh },
  { href: '/carousel', label: 'Carousel', hint: 'Multi-slide posters', icon: Layers },
  { href: '/newsletter', label: 'Newsletter', hint: 'Digest from docs', icon: Mail },
  { href: '/competitors', label: 'Competitors', hint: 'Monitor & remix', icon: Radar },
  { href: '/brand-studio', label: 'Brand Studio', hint: 'Templates & art', icon: Sparkles },
  { href: '/ai-assistant', label: 'AI Assistant', hint: 'Chat to create', icon: MessageSquare },
] as const;

function navActive(pathname: string, href: string) {
  return (
    pathname === href ||
    (href !== '/brand-studio' && pathname.startsWith(href)) ||
    (href === '/brand-studio' && pathname.startsWith('/brand-studio'))
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    setCreateOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen || createOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen, createOpen]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  const activeLabel = NAV_ITEMS.find((n) => pathname.startsWith(n.href))?.label ?? 'Console';
  const immersiveBrandStudio =
    pathname === '/brand-studio/inhouse' ||
    pathname === '/brand-studio/placid' ||
    pathname.startsWith('/brand-studio/inhouse/') ||
    pathname.startsWith('/brand-studio/placid/');

  if (immersiveBrandStudio) {
    return (
      <div className="flex min-h-screen flex-col bg-[hsl(var(--background))]">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]/95 px-2 backdrop-blur sm:gap-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link href="/brand-studio" className="truncate text-sm font-semibold text-brand-600">
              {APP_NAME}
            </Link>
            <span className="hidden text-[hsl(var(--border))] sm:inline">/</span>
            <span className="truncate text-xs text-[hsl(var(--muted-foreground))] sm:text-sm">
              {pathname.includes('placid') ? 'Design library' : 'In-house editor'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <NotificationBell />
            <BackButton href="/brand-studio" label="Studio" className="!min-h-[44px] !min-w-[44px] !px-2 text-xs sm:!min-w-0 sm:!px-3" />
            <button type="button" onClick={toggle} className="btn-ghost !min-h-[44px] !min-w-[44px] !p-2" aria-label="Toggle theme">
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto pb-[env(safe-area-inset-bottom,0px)]">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[hsl(var(--background))]">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))] md:flex">
        <div className="border-b border-[hsl(var(--border))] p-4">
          <h1 className="text-xl font-bold tracking-tight text-brand-600">{APP_NAME}</h1>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{APP_TAGLINE}</p>
          <div className="mt-3">
            <CompanySwitcher />
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 min-h-[44px]',
                navActive(pathname, href)
                  ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/20'
                  : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:translate-x-0.5',
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-[hsl(var(--border))] space-y-2">
          <div className="text-xs text-[hsl(var(--muted-foreground))] px-3 truncate">
            {user?.name} · {user?.role}
            {user?.companyName ? ` · ${user.companyName}` : ''}
          </div>
          <button type="button" onClick={toggle} className="btn-ghost w-full justify-start gap-3">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="btn-ghost w-full justify-start gap-3 text-red-600 hover:bg-red-500/10"
          >
            {loggingOut ? <Spinner size={18} /> : <LogOut size={18} />}
            {loggingOut ? 'Signing out…' : 'Log out'}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-2 px-2.5 py-2 sm:gap-3 sm:px-4 sm:py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              className="btn-secondary !min-h-[44px] !min-w-[44px] !p-2.5 md:hidden"
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-brand-600 truncate md:hidden">{APP_NAME}</h1>
              <p className="hidden md:block text-sm text-[hsl(var(--muted-foreground))]">{activeLabel}</p>
              <p className="truncate text-[11px] text-[hsl(var(--muted-foreground))] md:hidden">{activeLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={toggle}
              className="btn-ghost !min-h-[44px] !min-w-[44px] !p-2.5 md:hidden"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <NotificationBell />
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-2.5 py-2 text-sm min-h-[44px] min-w-[44px] justify-center text-[hsl(var(--muted-foreground))] hover:text-red-600 hover:border-red-500/40 hover:bg-red-500/5 transition-colors sm:px-3"
              title="Log out"
            >
              {loggingOut ? <Spinner size={16} /> : <LogOut size={16} />}
              <span className="hidden sm:inline">{loggingOut ? 'Signing out…' : 'Log out'}</span>
            </button>
          </div>
        </header>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px] animate-fade-in"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 flex w-[min(86vw,21rem)] flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl animate-slide-in-left overscroll-contain">
              <div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-4">
                <div>
                  <p className="font-bold text-brand-600">{APP_NAME}</p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{APP_TAGLINE}</p>
                </div>
                <button type="button" className="btn-ghost !min-h-[44px] !min-w-[44px] !p-2" onClick={() => setMobileOpen(false)}>
                  <X size={18} />
                </button>
              </div>
              <div className="border-b border-[hsl(var(--border))] px-3 py-3">
                <CompanySwitcher compact />
              </div>
              <nav className="flex-1 space-y-1 overflow-y-auto p-3">
                {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className={clsx(
                      'flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all active:scale-[0.98]',
                      navActive(pathname, href)
                        ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
                        : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]',
                    )}
                  >
                    <Icon size={18} />
                    {label}
                  </Link>
                ))}
              </nav>
              <div className="space-y-2 border-t border-[hsl(var(--border))] p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                <p className="truncate px-3 text-xs text-[hsl(var(--muted-foreground))]">
                  {user?.name} · {user?.role}
                </p>
                <button type="button" onClick={toggle} className="btn-ghost w-full justify-start">
                  {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                  {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
                <button type="button" onClick={handleLogout} disabled={loggingOut} className="btn-ghost w-full justify-start text-red-600">
                  {loggingOut ? <Spinner size={18} /> : <LogOut size={18} />}
                  {loggingOut ? 'Signing out…' : 'Log out'}
                </button>
              </div>
            </aside>
          </div>
        )}

        {createOpen && (
          <div className="fixed inset-0 z-[55] md:hidden">
            <button
              type="button"
              aria-label="Close create menu"
              className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px] animate-fade-in"
              onClick={() => setCreateOpen(false)}
            />
            <div
              className="absolute inset-x-0 bottom-0 max-h-[min(78dvh,32rem)] overflow-y-auto overscroll-contain rounded-t-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl animate-slide-up"
              role="dialog"
              aria-modal="true"
              aria-label="Create content"
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[hsl(var(--muted-foreground))]/35" />
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Create</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Pick a workflow</p>
                </div>
                <button
                  type="button"
                  className="btn-ghost !min-h-[44px] !min-w-[44px] !p-2"
                  onClick={() => setCreateOpen(false)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {CREATE_SHEET_ITEMS.map(({ href, label, hint, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className={clsx(
                      'flex min-h-[56px] items-center gap-3 rounded-2xl border px-3.5 py-3 transition-all active:scale-[0.98]',
                      navActive(pathname, href)
                        ? 'border-brand-500 bg-brand-500/10'
                        : 'border-[hsl(var(--border))] bg-[hsl(var(--background))]',
                    )}
                  >
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-700 dark:text-brand-300">
                      <Icon size={20} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{label}</span>
                      <span className="block text-xs text-[hsl(var(--muted-foreground))]">{hint}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        <main
          key={pathname}
          className="flex-1 overflow-auto p-3 pb-[calc(6.25rem+env(safe-area-inset-bottom,0px))] sm:p-4 md:p-6 md:pb-8 xl:p-8 animate-page-enter"
        >
          {children}
        </main>

        <nav
          className="fixed inset-x-1.5 z-40 grid grid-cols-5 gap-0.5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/95 p-1 shadow-xl backdrop-blur-md sm:inset-x-2 sm:p-1.5 md:hidden"
          style={{ bottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
          aria-label="Primary"
        >
          {MOBILE_DOCK.map(({ href, label, icon: Icon }) => {
            if (href === '__create__') {
              return (
                <button
                  key={href}
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className={clsx(
                    'flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium transition-all active:scale-95',
                    createOpen
                      ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
                      : 'text-[hsl(var(--muted-foreground))]',
                  )}
                  aria-label="Create content"
                  aria-expanded={createOpen}
                >
                  <span
                    className={clsx(
                      'inline-flex h-7 w-7 items-center justify-center rounded-full transition-transform duration-200',
                      createOpen ? 'bg-white/20 scale-105' : 'bg-brand-600 text-white',
                    )}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="truncate px-0.5">{label}</span>
                </button>
              );
            }
            const active = navActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium transition-all active:scale-95',
                  active
                    ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
                    : 'text-[hsl(var(--muted-foreground))]',
                )}
              >
                <Icon size={17} />
                <span className="truncate px-0.5">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  Image as ImageIcon,
} from 'lucide-react';
import { InlineNotice, Skeleton } from '@/components/ui';
import {
  PlatformBadge,
  PlatformBadgeList,
  PlatformIcon,
  formatPlatformLabel,
} from '@/components/platform-badge';

type PostLink = {
  platform: string;
  url: string | null;
  platformPostId: string | null;
  accountName: string | null;
};

type PublishedPost = {
  id: string;
  engine: string;
  imageUrl: string | null;
  publishedAt: string | null;
  platforms: string[];
  links: PostLink[];
  caption: {
    headline: string;
    body: string;
    hashtags: string[];
    callToAction?: string | null;
  };
  captions: Array<{
    platform: string;
    headline: string;
    body: string;
    hashtags: string[];
    callToAction?: string | null;
  }>;
};

interface DashboardData {
  published: number;
  publishedContent: PublishedPost[];
}

function mediaUrl(url?: string | null): string {
  if (!url) return '';
  if (/^(https?:|data:)/.test(url)) return url;
  const [pathPart, query] = url.split('?');
  const encoded = pathPart
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return encodeURIComponent(segment);
      }
    })
    .join('/');
  return query ? `${encoded}?${query}` : encoded;
}

function formatPublishedStamp(iso: string): {
  weekday: string;
  date: string;
  time: string;
} {
  const d = new Date(iso);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'long' }),
    date: d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
    time: d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }),
  };
}

function PublishedStamp({ publishedAt }: { publishedAt: string | null }) {
  if (!publishedAt) {
    return (
      <span className="shrink-0 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
        Published
      </span>
    );
  }
  const stamp = formatPublishedStamp(publishedAt);
  return (
    <div
      className="inline-flex shrink-0 items-center gap-2.5 rounded-xl border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-brand-800 dark:text-brand-200"
      title={`Published ${stamp.weekday}, ${stamp.date} at ${stamp.time}`}
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm shadow-brand-600/25">
        <CalendarDays size={15} />
      </span>
      <div className="min-w-0 leading-tight">
        <p className="text-[11px] font-bold uppercase tracking-wide">{stamp.weekday}</p>
        <p className="text-sm font-semibold tabular-nums">{stamp.date}</p>
        <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-brand-700/90 dark:text-brand-300">
          <Clock size={11} />
          {stamp.time}
        </p>
      </div>
    </div>
  );
}

/** Buttons that open the live post on each network it went out to. */
function PostLinks({ links }: { links: PostLink[] }) {
  if (!links?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {links.map((link) => {
        const label = formatPlatformLabel(link.platform);
        if (link.url) {
          return (
            <a
              key={link.platform}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              title={
                link.accountName
                  ? `Open this post on ${label} (${link.accountName})`
                  : `Open this post on ${label}`
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1.5 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-500/40 hover:text-brand-600 hover:shadow-sm"
            >
              <PlatformIcon platform={link.platform} size={14} />
              <span>View on {label}</span>
              <ExternalLink size={12} className="opacity-60" />
            </a>
          );
        }
        return (
          <span
            key={link.platform}
            title={
              link.platformPostId
                ? `${label} did not return a public link for this post (id ${link.platformPostId}).`
                : `${label} did not return a public link for this post.`
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[hsl(var(--border))] px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]"
          >
            <PlatformIcon platform={link.platform} size={14} />
            <span>{label} · no link</span>
          </span>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const { user, companies } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    api<{ data: DashboardData }>('/dashboard/stats')
      .then((res) => setData(res.data))
      .catch(() => setError('Could not load published posts. Refresh in a few seconds.'));
  }, [user?.tenantId]);

  return (
    <AuthGuard>
      <div className="page-container animate-page-enter">
        <header className="page-header">
          <div>
            <p className="panel-kicker mb-1">Live content</p>
            <h1 className="page-title">Published posts</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              What was posted for{' '}
              <span className="font-medium text-[hsl(var(--foreground))]">
                {user?.companyName || user?.tenantName || 'this company'}
              </span>
              , where it went, and the exact caption used.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
              <CheckCircle2 className="text-emerald-600" size={20} />
              <div>
                {data ? (
                  <p className="text-xl font-bold leading-none">{data.published}</p>
                ) : (
                  <Skeleton className="h-6 w-10" />
                )}
                <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                  Total published
                </p>
              </div>
            </div>
          </div>
        </header>

        <section className="panel overflow-hidden animate-fade-in">
          <div className="panel-body !p-0">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-5">
              <div className="flex min-w-0 items-start gap-3 sm:items-center">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-md shadow-brand-600/25 transition-transform duration-300 hover:scale-105">
                  <Building2 size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    Active brand
                  </p>
                  <p className="truncate text-lg font-bold tracking-tight text-[hsl(var(--foreground))] sm:text-xl">
                    {user?.companyName || user?.tenantName || 'Company'}
                  </p>
                  <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                    {(companies.length || 1) === 1
                      ? 'Published posts below are for this company.'
                      : `${companies.length} companies · posts below are for this brand only.`}
                  </p>
                </div>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row">
                <Link
                  href="/choose-company"
                  className="btn-sector-outline inline-flex w-full items-center justify-center gap-2 !min-h-[44px] !px-4 text-sm transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] sm:w-auto"
                >
                  Switch company
                </Link>
                <Link
                  href="/settings"
                  className="btn-sector inline-flex w-full items-center justify-center gap-2 !min-h-[44px] !px-4 text-sm transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] sm:w-auto"
                >
                  Brand settings
                </Link>
              </div>
            </div>
          </div>
        </section>

        {error && <InlineNotice kind="error">{error}</InlineNotice>}

        {!data ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-80 w-full rounded-2xl" />
            ))}
          </div>
        ) : data.publishedContent.length === 0 ? (
          <div className="card flex min-h-64 flex-col items-center justify-center text-center">
            <CheckCircle2 size={34} className="mb-3 text-[hsl(var(--muted-foreground))]" />
            <p className="font-medium">No published posts yet</p>
            <p className="mt-1 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">
              Once a post is approved and successfully published, it will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.publishedContent.map((post) => (
              <article
                key={post.id}
                className="card !p-0 overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="flex flex-col gap-3 border-b border-[hsl(var(--border))] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-1.5">
                    <PlatformBadgeList platforms={post.platforms} size="sm" />
                  </div>
                  <PublishedStamp publishedAt={post.publishedAt} />
                </div>

                {post.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(post.imageUrl)}
                    alt={post.caption.headline || 'Published creative'}
                    className="aspect-[16/10] w-full bg-[hsl(var(--muted))] object-contain"
                  />
                ) : (
                  <div className="flex aspect-[16/10] items-center justify-center bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                    <ImageIcon size={28} />
                  </div>
                )}

                <div className="space-y-4 p-4">
                  <PostLinks links={post.links} />

                  {(post.captions?.length
                    ? post.captions
                    : [{ platform: post.platforms[0] || '', ...post.caption }]
                  ).map((caption) => (
                    <section key={caption.platform} className="space-y-2">
                      <p className="panel-kicker flex items-center gap-1.5">
                        {caption.platform ? (
                          <>
                            <PlatformBadge platform={caption.platform} size="sm" />
                            <span>caption</span>
                          </>
                        ) : (
                          'Caption'
                        )}
                      </p>
                      {caption.headline && (
                        <h2 className="font-semibold leading-snug">{caption.headline}</h2>
                      )}
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[hsl(var(--foreground))]">
                        {caption.body}
                      </p>
                      {caption.callToAction && (
                        <p className="text-sm font-medium text-brand-600">
                          {caption.callToAction}
                        </p>
                      )}
                      {caption.hashtags.length > 0 && (
                        <p className="text-xs leading-relaxed text-brand-600">
                          {caption.hashtags
                            .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
                            .join(' ')}
                        </p>
                      )}
                    </section>
                  ))}

                  <p className="border-t border-[hsl(var(--border))] pt-3 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    {post.engine.replace(/_/g, ' ')}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </AuthGuard>
  );
}

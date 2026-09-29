'use client';

import Link from 'next/link';
import {
  ExternalLink,
  LayoutTemplate,
  Library,
  Sparkles,
} from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';

export default function BrandStudioHubPage() {
  return (
    <AuthGuard>
      <div className="page-container !max-w-4xl animate-page-enter">
        <header className="relative overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-gradient-to-br from-[hsl(var(--card))] via-[hsl(var(--muted)/0.45)] to-brand-500/[0.07] p-5 sm:p-7">
          <div
            className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand-500/10 blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-24 -left-10 h-48 w-48 rounded-full bg-slate-400/10 blur-3xl dark:bg-slate-500/10"
            aria-hidden
          />
          <p className="panel-kicker relative">Templates &amp; art</p>
          <h1 className="relative mt-1 flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-[1.65rem]">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white shadow-md shadow-brand-600/25">
              <Sparkles size={20} />
            </span>
            Brand Studio
          </h1>
          <p className="relative mt-2 max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
            Open the design library or the in-house editor full-page so the canvas isn’t cropped by the
            sidebar.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:border-brand-500/35 hover:shadow-lg hover:shadow-brand-600/5">
            <span
              className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-brand-500 to-brand-700"
              aria-hidden
            />
            <div className="flex flex-1 flex-col gap-4 p-5 pl-6 sm:p-6 sm:pl-7">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 text-brand-700 transition-transform duration-200 group-hover:scale-105 dark:text-brand-300">
                <Library size={20} />
              </div>
              <div>
                <p className="text-base font-semibold tracking-tight">Design library</p>
                <p className="mt-1.5 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                  Connect your design source, import one or many templates, and manage dynamic layers on
                  a full-width page.
                </p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Link href="/brand-studio/placid" className="btn-primary min-h-[44px] gap-2 md:!min-h-[40px]">
                  Open library
                </Link>
                <a
                  href="/brand-studio/placid"
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary min-h-[44px] gap-2 md:!min-h-[40px]"
                >
                  <ExternalLink size={15} /> New tab
                </a>
              </div>
            </div>
          </article>

          <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:border-brand-500/35 hover:shadow-lg hover:shadow-brand-600/5">
            <span
              className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-slate-600 to-slate-800 dark:from-slate-400 dark:to-slate-600"
              aria-hidden
            />
            <div className="flex flex-1 flex-col gap-4 p-5 pl-6 sm:p-6 sm:pl-7">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-500/10 text-slate-800 transition-transform duration-200 group-hover:scale-105 dark:text-slate-200">
                <LayoutTemplate size={20} />
              </div>
              <div>
                <p className="text-base font-semibold tracking-tight">In-house editor</p>
                <p className="mt-1.5 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                  Upload brand plates and edit Fixed / Dynamic zones with a large canvas and fullscreen
                  tools.
                </p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Link href="/brand-studio/inhouse" className="btn-primary min-h-[44px] gap-2 md:!min-h-[40px]">
                  Open editor
                </Link>
                <a
                  href="/brand-studio/inhouse"
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary min-h-[44px] gap-2 md:!min-h-[40px]"
                >
                  <ExternalLink size={15} /> New tab
                </a>
              </div>
            </div>
          </article>
        </div>
      </div>
    </AuthGuard>
  );
}

'use client';

import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GCC_CODES,
  MARKET_COUNTRIES,
  REGION_META,
  countryLabel,
} from '@/lib/market-countries';

type Props = {
  value: string[];
  onToggle: (code: string) => void;
  onSet: (codes: string[]) => void;
};

export function MarketCountriesPicker({ value, onToggle, onSet }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const worldwide = value.includes('worldwide');
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return MARKET_COUNTRIES.filter((c) => c.code !== 'worldwide');
    return MARKET_COUNTRIES.filter((c) => {
      if (c.code === 'worldwide') return false;
      return (
        c.label.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.region.replace('_', ' ').includes(q)
      );
    });
  }, [q]);

  const gccSelected = GCC_CODES.filter((c) => value.includes(c)).length;
  const gccAllOn = GCC_CODES.every((c) => value.includes(c));

  const toggleGcc = () => {
    if (gccAllOn) {
      const next = value.filter((c) => !(GCC_CODES as readonly string[]).includes(c));
      onSet(next.length ? next : ['worldwide']);
      return;
    }
    const withoutWorld = value.filter((c) => c !== 'worldwide');
    onSet([...new Set([...withoutWorld, ...GCC_CODES])]);
  };

  const grouped = REGION_META.map((region) => ({
    ...region,
    countries: filtered.filter((c) => c.region === region.id),
  })).filter((g) => g.countries.length > 0);

  const selectedSummary = worldwide
    ? [{ code: 'worldwide', label: 'Worldwide', flag: '🌍' }]
    : MARKET_COUNTRIES.filter((c) => value.includes(c.code));

  const triggerLabel = worldwide
    ? 'Worldwide'
    : selectedSummary.length === 0
      ? 'Select markets…'
      : selectedSummary.length <= 2
        ? selectedSummary.map((c) => c.label).join(', ')
        : `${selectedSummary.length} markets selected`;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => searchRef.current?.focus(), 80);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <div ref={rootRef} className="relative space-y-3">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full min-h-[52px] items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition ${
          open
            ? 'border-brand-600 bg-brand-600/[0.06] ring-1 ring-brand-600/25'
            : 'border-[hsl(var(--border))] hover:border-brand-600/40 bg-[hsl(var(--background))]'
        }`}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {selectedSummary.slice(0, 6).map((c) => (
            <span
              key={c.code}
              className="inline-flex items-center gap-1 rounded-full border border-brand-600/20 bg-brand-600/10 px-2 py-0.5 text-[11px] font-medium"
            >
              <span aria-hidden className="text-sm leading-none">
                {c.flag}
              </span>
              <span className="max-w-[9rem] truncate">{c.label}</span>
            </span>
          ))}
          {selectedSummary.length > 6 && (
            <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
              +{selectedSummary.length - 6}
            </span>
          )}
          {!selectedSummary.length && (
            <span className="text-sm text-[hsl(var(--muted-foreground))]">{triggerLabel}</span>
          )}
        </div>
        <ChevronDown
          size={18}
          className={`shrink-0 text-[hsl(var(--muted-foreground))] transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          open ? 'max-h-[28rem] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
        }`}
      >
        <div
          role="listbox"
          aria-multiselectable="true"
          className={`origin-top rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg shadow-black/5 transition-transform duration-300 ease-out ${
            open ? 'translate-y-0 scale-100' : '-translate-y-1 scale-[0.98]'
          }`}
        >
          <div className="border-b border-[hsl(var(--border))] p-3 space-y-2">
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
              />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search countries…"
                className="input !pl-9 min-h-[44px] md:!min-h-[40px]"
                aria-label="Search countries"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onToggle('worldwide')}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                  worldwide
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-[hsl(var(--border))] hover:border-brand-600/40'
                }`}
              >
                <span aria-hidden>🌍</span>
                Worldwide
              </button>
              <button
                type="button"
                onClick={toggleGcc}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                  gccAllOn && !worldwide
                    ? 'border-brand-600 bg-brand-600/10 text-brand-700'
                    : 'border-[hsl(var(--border))] hover:border-brand-600/40'
                }`}
              >
                Select all GCC{gccSelected && !gccAllOn ? ` (${gccSelected}/6)` : ''}
              </button>
              {!worldwide && selectedSummary.length > 0 && (
                <button
                  type="button"
                  onClick={() => onSet(['worldwide'])}
                  className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                >
                  <X size={12} />
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[18rem] overflow-y-auto overscroll-contain p-2 space-y-3">
            {grouped.map((group) => (
              <div key={group.id}>
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.countries.map((c) => {
                    const on = !worldwide && value.includes(c.code);
                    return (
                      <button
                        key={c.code}
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => onToggle(c.code)}
                        className={`flex w-full min-h-[44px] items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                          on
                            ? 'bg-brand-600/[0.08]'
                            : 'hover:bg-[hsl(var(--muted)/0.45)]'
                        }`}
                      >
                        <span
                          className={`flex size-5 shrink-0 items-center justify-center rounded-md border transition ${
                            on
                              ? 'border-brand-600 bg-brand-600 text-white'
                              : 'border-[hsl(var(--border))] bg-[hsl(var(--background))]'
                          }`}
                        >
                          {on ? <Check size={12} strokeWidth={3} /> : null}
                        </span>
                        <span className="text-lg leading-none" aria-hidden>
                          {c.flag}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {c.label}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                          {c.code}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {grouped.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
                No countries match “{query}”.
              </p>
            )}
          </div>
        </div>
      </div>

      {!open && (
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
          {worldwide
            ? '🌍 Worldwide — global English, no country filter'
            : `${selectedSummary.map((c) => `${c.flag} ${c.label}`).join(' · ')}`}
        </p>
      )}
    </div>
  );
}

export function selectedMarketSummary(codes: string[]): string {
  if (codes.includes('worldwide') || !codes.length) return 'Worldwide';
  return codes.map(countryLabel).join(', ');
}

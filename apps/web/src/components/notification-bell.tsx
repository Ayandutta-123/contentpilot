'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { useNotifications } from '@/lib/notification-context';
import clsx from 'clsx';
import { Spinner } from '@/components/ui';

const KIND_STYLE: Record<string, string> = {
  error: 'border-l-red-500 bg-red-500/5',
  success: 'border-l-emerald-500 bg-emerald-500/5',
  warning: 'border-l-amber-500 bg-amber-500/5',
  info: 'border-l-brand-500 bg-brand-500/5',
};

export function NotificationBell() {
  const {
    items, unreadCount, soundEnabled, setSoundEnabled,
    markRead, markAllRead, clearAll, deleteSelected,
  } = useNotifications();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSelected(new Set());
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const allSelected = items.length > 0 && selected.size === items.length;
  const someSelected = selected.size > 0;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  };

  const handleDeleteSelected = async () => {
    if (!someSelected) return;
    setBusy(true);
    try {
      await deleteSelected([...selected]);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!items.length) return;
    if (!window.confirm(`Delete all ${items.length} notifications?`)) return;
    setBusy(true);
    try {
      await clearAll();
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  const closePanel = () => {
    setOpen(false);
    setSelected(new Set());
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'relative p-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]',
          'hover:border-brand-500/50 transition-all duration-200 active:scale-95 min-h-[44px] min-w-[44px]',
          unreadCount > 0 && 'motion-safe:animate-bell-shake',
        )}
      >
        <Bell size={20} className={unreadCount > 0 ? 'text-brand-600' : 'text-[hsl(var(--muted-foreground))]'} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse-soft">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-[55] bg-slate-950/45 backdrop-blur-[2px] animate-fade-in md:hidden"
            onClick={closePanel}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            className={clsx(
              'z-[60] overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl',
              'fixed inset-x-0 bottom-0 max-h-[min(78dvh,32rem)] rounded-t-3xl animate-slide-up',
              'pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]',
              'md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:mt-2 md:max-h-none md:w-[min(100vw-2rem,24rem)]',
              'md:rounded-2xl md:pb-0 md:animate-slide-down',
            )}
          >
            <div className="mx-auto mb-1 mt-2 h-1 w-10 rounded-full bg-[hsl(var(--muted-foreground))]/35 md:hidden" />
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[hsl(var(--border))]">
              <div>
                <p className="font-semibold text-sm">Notifications</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {unreadCount} unread{someSelected ? ` · ${selected.size} selected` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title={soundEnabled ? 'Mute alerts' : 'Enable sound'}
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))]"
                >
                  {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                </button>
                <button
                  type="button"
                  title="Mark all read"
                  onClick={() => markAllRead()}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))]"
                >
                  <CheckCheck size={16} />
                </button>
                <button
                  type="button"
                  onClick={closePanel}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))]"
                  aria-label="Close notifications"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {items.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40">
                <label className="flex items-center gap-2.5 text-xs min-h-[44px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-5 w-5 rounded border-[hsl(var(--border))]"
                  />
                  Select all
                </label>
                <div className="flex-1" />
                <button
                  type="button"
                  disabled={!someSelected || busy}
                  onClick={handleDeleteSelected}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-40 min-h-[44px] transition-colors active:scale-[0.97]"
                >
                  {busy ? <Spinner size={14} /> : <Trash2 size={14} />}
                  {busy ? 'Deleting…' : 'Delete selected'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleDeleteAll}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 disabled:opacity-40 min-h-[44px] transition-colors active:scale-[0.97]"
                >
                  {busy ? <Spinner size={14} /> : <Trash2 size={14} />}
                  {busy ? 'Deleting…' : 'Delete all'}
                </button>
              </div>
            )}

            <div className="max-h-[min(52dvh,22rem)] overflow-y-auto md:max-h-[60vh]">
              {items.length === 0 ? (
                <p className="text-sm text-center text-[hsl(var(--muted-foreground))] py-10 px-4">
                  No notifications yet
                </p>
              ) : (
                items.map((n) => {
                  const checked = selected.has(n.id);
                  return (
                    <div
                      key={n.id}
                      className={clsx(
                        'flex items-start gap-2 px-3 py-3 border-b border-[hsl(var(--border))] border-l-4 transition-colors',
                        KIND_STYLE[n.kind] ?? KIND_STYLE.info,
                        !n.readAt && 'font-medium',
                        checked && 'bg-brand-500/5',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(n.id)}
                        className="mt-1 rounded border-[hsl(var(--border))] min-h-[18px] min-w-[18px]"
                        aria-label={`Select ${n.title}`}
                      />
                      <div className="min-w-0 flex-1">
                        {n.href ? (
                          <Link
                            href={n.href}
                            onClick={() => {
                              if (!n.id.startsWith('local-')) markRead(n.id);
                              closePanel();
                            }}
                            className="block hover:opacity-90"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm">{n.title}</p>
                              <span className="text-[10px] text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                                {new Date(n.createdAt).toLocaleTimeString()}
                              </span>
                            </div>
                            {n.message && (
                              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 line-clamp-3">{n.message}</p>
                            )}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            className="w-full text-left min-h-[44px]"
                            onClick={() => {
                              if (!n.id.startsWith('local-')) markRead(n.id);
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm">{n.title}</p>
                              <span className="text-[10px] text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                                {new Date(n.createdAt).toLocaleTimeString()}
                              </span>
                            </div>
                            {n.message && (
                              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 line-clamp-3">{n.message}</p>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

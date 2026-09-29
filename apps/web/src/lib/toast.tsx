'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import clsx from 'clsx';

export type ToastKind = 'success' | 'error';

export type ToastItem = {
  id: string;
  kind: ToastKind;
  message: string;
};

type ToastApi = {
  push: (kind: ToastKind, message: string) => void;
  success: (message?: string) => void;
  error: (message: string) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** Imperative bridge so non-hook code can fire toasts. */
let imperativeApi: ToastApi | null = null;

function ensureMessage(message: string | undefined, fallback: string) {
  const trimmed = (message ?? '').trim();
  return trimmed || fallback;
}

export function notifySuccess(message = 'Saved') {
  imperativeApi?.success(message);
}

export function notifyError(message: string) {
  const trimmed = message.trim();
  if (!trimmed) {
    imperativeApi?.error("Couldn't save — Something went wrong");
    return;
  }
  if (/^couldn'?t\s/i.test(trimmed) || /^save failed/i.test(trimmed)) {
    imperativeApi?.error(trimmed);
    return;
  }
  imperativeApi?.error(`Couldn't save — ${trimmed}`);
}

/**
 * Run a persist action and show success/error toasts.
 * Re-throws so callers can keep local error state if needed.
 */
export async function withSaveFeedback<T>(
  action: () => Promise<T>,
  opts?: { success?: string; errorPrefix?: string },
): Promise<T> {
  try {
    const result = await action();
    notifySuccess(opts?.success ?? 'Saved');
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Something went wrong';
    const prefix = opts?.errorPrefix ?? "Couldn't save";
    imperativeApi?.error(`${prefix} — ${msg}`);
    throw e;
  }
}

/** Imperative helpers — `toast.error` shows the message as-is; `notifyError` prefixes save failures. */
export const toast = {
  success: (message = 'Saved') => notifySuccess(message),
  error: (message: string) => {
    imperativeApi?.error(ensureMessage(message, "Couldn't save"));
  },
};

const TOAST_TTL_MS = 3200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const text = ensureMessage(message, kind === 'success' ? 'Saved' : "Couldn't save");
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      setItems((prev) => {
        // Replace an identical in-flight toast instead of stacking duplicates
        const withoutDup = prev.filter((p) => !(p.kind === kind && p.message === text));
        return [...withoutDup, { id, kind, message: text }].slice(-3);
      });

      const existing = timers.current.get(id);
      if (existing) window.clearTimeout(existing);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), TOAST_TTL_MS),
      );
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (message) => push('success', ensureMessage(message, 'Saved')),
      error: (message) => push('error', ensureMessage(message, "Couldn't save")),
      dismiss,
    }),
    [push, dismiss],
  );

  useEffect(() => {
    imperativeApi = api;
    return () => {
      if (imperativeApi === api) imperativeApi = null;
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current.clear();
    };
  }, [api]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-[80] flex flex-col items-center gap-2 px-3 md:bottom-6"
        aria-live="polite"
        aria-relevant="additions"
      >
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const Icon = item.kind === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div
      role={item.kind === 'error' ? 'alert' : 'status'}
      className={clsx(
        'pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-sm shadow-lg backdrop-blur-md animate-slide-down',
        item.kind === 'success' &&
          'border-emerald-500/35 bg-[hsl(var(--card))]/95 text-emerald-800 dark:text-emerald-300',
        item.kind === 'error' &&
          'border-red-500/35 bg-[hsl(var(--card))]/95 text-red-700 dark:text-red-300',
      )}
    >
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 leading-snug text-[hsl(var(--foreground))]">{item.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

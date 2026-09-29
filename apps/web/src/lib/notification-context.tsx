'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { api, onApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  creditAlertFromNotification,
  onCreditAlert,
  type CreditAlertPayload,
} from '@/lib/credit-alert';
import { CreditWarningModal } from '@/components/credit-warning-modal';

export interface AppNotification {
  id: string;
  kind: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message: string;
  href?: string | null;
  readAt?: string | null;
  createdAt: string;
}

interface NotificationContextValue {
  items: AppNotification[];
  unreadCount: number;
  soundEnabled: boolean;
  setSoundEnabled: (v: boolean) => void;
  refresh: () => Promise<boolean>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearAll: () => Promise<void>;
  deleteSelected: (ids: string[]) => Promise<void>;
  pushLocal: (n: Omit<AppNotification, 'id' | 'createdAt' | 'readAt'>) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function playAlertSound(kind: string) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    // Loud dual-tone for errors; softer chime for success
    const freqs = kind === 'error' ? [880, 660, 880] : kind === 'success' ? [523, 659, 784] : [440, 550];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = kind === 'error' ? 'square' : 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      const start = now + i * 0.18;
      gain.gain.setValueAtTime(kind === 'error' ? 0.35 : 0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.start(start);
      osc.stop(start + 0.28);
    });
  } catch {
    // Autoplay restrictions — ignore
  }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [creditAlert, setCreditAlert] = useState<CreditAlertPayload | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const lastLocalError = useRef<{ key: string; at: number } | null>(null);
  const dismissedCredits = useRef<Map<string, number>>(new Map());

  const wasJustDismissed = (tool: string) => {
    const at = dismissedCredits.current.get(tool);
    return Boolean(at && Date.now() - at < 45_000);
  };

  const refresh = useCallback(async () => {
    if (!user) return false;
    try {
      const res = await api<{ data: { items: AppNotification[]; unreadCount: number } }>('/notifications');
      const next = res.data.items;

      if (primed.current && soundEnabled) {
        for (const n of next) {
          if (!seenIds.current.has(n.id) && !n.readAt) {
            playAlertSound(n.kind);
          }
        }
      }

      next.forEach((n) => seenIds.current.add(n.id));
      primed.current = true;
      setItems(next);
      setUnreadCount(res.data.unreadCount);

      const unpaid = next.find((n) => !n.readAt && n.title.startsWith('Add money to '));
      if (unpaid) {
        const alert = creditAlertFromNotification(unpaid);
        if (alert) {
          if (wasJustDismissed(alert.tool)) {
            if (!unpaid.id.startsWith('local-')) {
              api(`/notifications/${unpaid.id}/read`, { method: 'POST' }).catch(() => undefined);
            }
          } else {
            setCreditAlert(alert);
          }
        }
      }
      return true;
    } catch {
      // silent — don't spam on auth pages or brief API restarts
      return false;
    }
  }, [user, soundEnabled]);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setUnreadCount(0);
      setCreditAlert(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delayMs = 15_000;

    const tick = async () => {
      const ok = await refresh();
      if (cancelled) return;
      if (ok) {
        // Drop stale local "API unreachable" cards left from earlier restarts
        setItems((prev) =>
          prev.filter(
            (n) =>
              !(
                n.id.startsWith('local-') &&
                /unreachable|restarting|Failed to fetch|NetworkError/i.test(n.message)
              ),
          ),
        );
      }
      // Back off while API is down so we don't flood Cursor Issues / proxy errors
      delayMs = ok ? 15_000 : Math.min(delayMs * 2, 60_000);
      timer = setTimeout(() => {
        void tick();
      }, delayMs);
    };

    void tick();

    const unsubErr = onApiError((message) => {
      // Never turn transient restart blips into bell "issues"
      if (/unreachable|restarting|Failed to fetch|NetworkError/i.test(message)) return;
      // Deduplicate identical errors within 30s so we never flood the bell
      const key = message.slice(0, 120);
      const now = Date.now();
      const last = lastLocalError.current;
      if (last && last.key === key && now - last.at < 30_000) return;
      lastLocalError.current = { key, at: now };
      pushLocal({ kind: 'error', title: 'Request failed', message });
    });
    const unsubCredit = onCreditAlert((payload) => {
      if (wasJustDismissed(payload.tool)) return;
      setCreditAlert(payload);
      if (soundEnabled) playAlertSound('warning');
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubErr();
      unsubCredit();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, refresh]);

  useEffect(() => {
    const stored = localStorage.getItem('cp_sound');
    if (stored != null) setSoundEnabled(stored === '1');
  }, []);

  const persistSound = (v: boolean) => {
    setSoundEnabled(v);
    localStorage.setItem('cp_sound', v ? '1' : '0');
  };

  const markRead = async (id: string) => {
    await api(`/notifications/${id}/read`, { method: 'POST' });
    await refresh();
  };

  const markAllRead = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    await refresh();
  };

  const clearAll = async () => {
    const hasServer = items.some((n) => !n.id.startsWith('local-'));
    if (hasServer) {
      await api('/notifications', { method: 'DELETE' });
    }
    setItems([]);
    setUnreadCount(0);
  };

  const deleteSelected = async (ids: string[]) => {
    if (!ids.length) return;
    const serverIds = ids.filter((id) => !id.startsWith('local-'));
    if (serverIds.length) {
      await api('/notifications/bulk-delete', { method: 'POST', body: { ids: serverIds } });
    }
    setItems((prev) => prev.filter((n) => !ids.includes(n.id)));
    setUnreadCount((c) => {
      const removedUnread = items.filter((n) => ids.includes(n.id) && !n.readAt).length;
      return Math.max(0, c - removedUnread);
    });
  };

  const dismissCreditAlert = async () => {
    const current = creditAlert;
    if (current) dismissedCredits.current.set(current.tool, Date.now());
    setCreditAlert(null);
    const ids = new Set<string>();
    if (current?.notificationId && !current.notificationId.startsWith('local-')) {
      ids.add(current.notificationId);
    }
    items
      .filter((n) => !n.readAt && n.title.startsWith('Add money to '))
      .forEach((n) => {
        if (!n.id.startsWith('local-')) ids.add(n.id);
      });
    for (const id of ids) {
      await api(`/notifications/${id}/read`, { method: 'POST' }).catch(() => undefined);
    }
    await refresh();
  };

  const pushLocal = (n: Omit<AppNotification, 'id' | 'createdAt' | 'readAt'>) => {
    const local: AppNotification = {
      ...n,
      id: `local-${Date.now()}`,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    setItems((prev) => [local, ...prev]);
    setUnreadCount((c) => c + 1);
    if (soundEnabled) playAlertSound(n.kind);
  };

  return (
    <NotificationContext.Provider
      value={{
        items,
        unreadCount,
        soundEnabled,
        setSoundEnabled: persistSound,
        refresh,
        markRead,
        markAllRead,
        clearAll,
        deleteSelected,
        pushLocal,
      }}
    >
      {children}
      {creditAlert ? <CreditWarningModal alert={creditAlert} onOk={() => void dismissCreditAlert()} /> : null}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

'use client';

import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { api } from '@/lib/api';
import {
  Ban, CheckCircle, Clock, Eye, Image as ImageIcon, Loader2, Trash2,
} from 'lucide-react';
import { InlineNotice, ProcessingButton, Skeleton } from '@/components/ui';

interface PendingItem {
  id: string;
  headline: string;
  body: string;
  hashtags: string[];
  engine: string;
  status: string;
  revisionCount: number;
  imageUrl: string | null;
  createdAt: string;
  sourceReference: string | null;
}

function statusBadgeClass(status: string) {
  if (status === 'generating') return 'status-badge-generating';
  if (status === 'manual_intervention') return 'status-badge border-orange-500/30 bg-orange-500/10 text-orange-800 dark:text-orange-200';
  return 'status-badge-pending';
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const reload = useCallback(async () => {
    const res = await api<{ data: PendingItem[] }>('/content/pending');
    setItems(res.data);
    return res.data;
  }, []);

  useEffect(() => {
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [reload]);

  const abortItem = async (id: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Abort this post? It will leave the queue as rejected (not deleted).')) return;
    setBusyId(id);
    setError('');
    setOkMsg('');
    try {
      await api(`/content/${id}/abort`, { method: 'POST', body: {} });
      setOkMsg('Post aborted');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Abort failed');
    } finally {
      setBusyId(null);
    }
  };

  const deleteItem = async (id: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Delete this post permanently? It will be removed from the database and cannot be undone.')) return;
    setBusyId(id);
    setError('');
    setOkMsg('');
    try {
      await api(`/content/${id}`, { method: 'DELETE' });
      setOkMsg('Post deleted');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  const clearQueue = async () => {
    if (!items.length) return;
    if (
      !window.confirm(
        `Clear all ${items.length} item(s) from Approvals? They will be permanently deleted from the database.`,
      )
    ) {
      return;
    }
    setClearing(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{ data: { cleared: number } }>('/content/pending/clear', {
        method: 'POST',
        body: {},
      });
      setOkMsg(`Cleared ${res.data.cleared} item(s)`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear failed');
    } finally {
      setClearing(false);
    }
  };

  return (
    <AuthGuard>
      <div className="page-container animate-fade-in">
        <div className="page-header">
          <div>
            <h1 className="page-title">Approval Queue</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Review, abort, or delete drafts before publishing.
            </p>
          </div>
          {items.length > 0 && (
            <ProcessingButton
              variant="danger-outline"
              className="btn-sm shrink-0"
              loading={clearing}
              loadingText="Clearing…"
              icon={<Trash2 size={14} />}
              onClick={() => void clearQueue()}
            >
              Clear queue
            </ProcessingButton>
          )}
        </div>

        {(error || okMsg) && (
          <InlineNotice kind={error ? 'error' : 'success'}>{error || okMsg}</InlineNotice>
        )}

        {loading ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="panel">
                <div className="panel-body flex gap-3">
                  <Skeleton className="h-20 w-20 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="panel">
            <div className="panel-body py-14 text-center">
              <CheckCircle size={44} className="mx-auto mb-3 text-emerald-500" />
              <p className="font-semibold">All caught up</p>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                No content waiting in Approvals.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {items.map((item) => {
              const busy = busyId === item.id;
              return (
                <div key={item.id} className="panel group relative transition hover:border-brand-500/35 hover:shadow-md">
                  <Link href={`/approvals/${item.id}`} className="absolute inset-0 z-0 rounded-2xl" aria-label={`Review ${item.headline || 'post'}`} />
                  <div className="panel-body relative z-[1] pointer-events-none">
                    <div className="flex gap-3">
                      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[hsl(var(--muted-foreground))]">
                            {item.status === 'generating' ? (
                              <Loader2 size={18} className="animate-spin" />
                            ) : (
                              <ImageIcon size={18} />
                            )}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="status-badge-engine capitalize">{item.engine}</span>
                          <span className={`${statusBadgeClass(item.status)} capitalize`}>
                            {item.status.replace(/_/g, ' ')}
                          </span>
                          {item.revisionCount > 0 && (
                            <span className="status-badge-muted">Rev. {item.revisionCount}</span>
                          )}
                        </div>
                        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">
                          {item.headline || 'Untitled draft'}
                        </h3>
                        <p className="mt-1 line-clamp-2 text-xs text-[hsl(var(--muted-foreground))]">
                          {item.body || 'No caption yet'}
                        </p>
                        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                          <Clock size={12} />
                          {new Date(item.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="pointer-events-auto mt-3 flex flex-wrap gap-2 border-t border-[hsl(var(--border))] pt-3">
                      <Link href={`/approvals/${item.id}`} className="btn-primary btn-sm flex-1 sm:flex-none">
                        <Eye size={13} />
                        Review
                      </Link>
                      <button
                        type="button"
                        className="btn-danger-outline btn-sm"
                        disabled={busy || clearing}
                        onClick={(e) => void abortItem(item.id, e)}
                      >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                        Abort
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        disabled={busy || clearing}
                        onClick={(e) => void deleteItem(item.id, e)}
                      >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AuthGuard>
  );
}

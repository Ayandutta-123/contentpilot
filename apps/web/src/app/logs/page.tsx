'use client';

import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';
import { api } from '@/lib/api';
import { ProcessingButton, Skeleton, Spinner } from '@/components/ui';
import { notifyError, notifySuccess } from '@/lib/toast';

interface LogItem {
  id: string;
  workflowStep: string;
  engine: string | null;
  status: string;
  message: string | null;
  durationMs: number | null;
  createdAt: string;
  content: { headline: string; engine: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  success: 'bg-emerald-500/10 text-emerald-600',
  running: 'bg-blue-500/10 text-blue-600',
  transient_failure: 'bg-amber-500/10 text-amber-600',
  hard_failure: 'bg-red-500/10 text-red-600',
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    const params = filter ? `?status=${filter}` : '';
    setLoading(true);
    try {
      const res = await api<{ data: { items: LogItem[] } }>(`/dashboard/logs${params}`);
      setLogs(res.data.items);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Could not load logs');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearLogs = async () => {
    const scope = filter
      ? `all “${filter.replace(/_/g, ' ')}” logs`
      : 'all execution logs';
    if (!window.confirm(`Clear ${scope} for this workspace? This cannot be undone.`)) return;

    setClearing(true);
    try {
      const params = filter ? `?status=${encodeURIComponent(filter)}` : '';
      const res = await api<{ data: { deletedCount: number }; message?: string }>(
        `/dashboard/logs${params}`,
        { method: 'DELETE' },
      );
      setLogs([]);
      await load();
      notifySuccess(res.message || `Cleared ${res.data.deletedCount} logs`);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Couldn't clear logs");
    } finally {
      setClearing(false);
    }
  };

  return (
    <AuthGuard>
      <div className="page-container">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="page-title">Execution Logs</h1>
            <p className="mt-1 text-[hsl(var(--muted-foreground))]">Workflow audit trail</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-auto">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="input w-full pr-10 sm:w-auto"
              >
                <option value="">All statuses</option>
                <option value="success">Success</option>
                <option value="hard_failure">Hard Failure</option>
                <option value="transient_failure">Transient Failure</option>
              </select>
              {loading && <Spinner size={15} className="absolute right-3 top-3.5 text-brand-600" />}
            </div>
            <ProcessingButton
              variant="danger-outline"
              className="w-full sm:w-auto"
              icon={<Trash2 size={15} />}
              loading={clearing}
              loadingText="Clearing…"
              disabled={loading || clearing || logs.length === 0}
              onClick={() => void clearLogs()}
            >
              {filter ? 'Clear filtered logs' : 'Clear all logs'}
            </ProcessingButton>
          </div>
        </div>

        {loading && logs.length === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <div className="card !p-0 overflow-hidden">
            <div className="divide-y divide-[hsl(var(--border))] sm:hidden">
              {logs.map((log) => (
                <div key={log.id} className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="break-all font-mono text-xs font-medium">{log.workflowStep}</p>
                    <span className={`status-badge shrink-0 ${STATUS_STYLES[log.status] ?? ''}`}>
                      {log.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {log.message && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">{log.message}</p>
                  )}
                  <div className="flex justify-between gap-3 text-[10px] text-[hsl(var(--muted-foreground))]">
                    <span>{new Date(log.createdAt).toLocaleString()}</span>
                    <span>{log.durationMs ? `${log.durationMs}ms` : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))]">
                    <th className="py-2 text-left font-medium">Time</th>
                    <th className="py-2 text-left font-medium">Step</th>
                    <th className="py-2 text-left font-medium">Status</th>
                    <th className="hidden py-2 text-left font-medium sm:table-cell">Message</th>
                    <th className="hidden py-2 text-left font-medium md:table-cell">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-[hsl(var(--border))] last:border-0">
                      <td className="whitespace-nowrap py-3 text-[hsl(var(--muted-foreground))]">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 font-mono text-xs">{log.workflowStep}</td>
                      <td className="py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[log.status] ?? ''}`}>
                          {log.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="hidden max-w-xs truncate py-3 text-[hsl(var(--muted-foreground))] sm:table-cell">
                        {log.message ?? '—'}
                      </td>
                      <td className="hidden py-3 text-[hsl(var(--muted-foreground))] md:table-cell">
                        {log.durationMs ? `${log.durationMs}ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {logs.length === 0 && (
              <p className="py-8 text-center text-[hsl(var(--muted-foreground))]">No logs found.</p>
            )}
          </div>
        )}
      </div>
    </AuthGuard>
  );
}

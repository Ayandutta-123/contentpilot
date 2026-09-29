'use client';

import { useEffect, useState } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { api } from '@/lib/api';
import { RotateCcw, Circle } from 'lucide-react';
import { ProcessingButton, Skeleton } from '@/components/ui';

interface RotationItem {
  id: string;
  name: string;
  engine: string;
  isActive: boolean;
  lastUsedAt: string | null;
  rotationOrder: number;
}

interface RotationData {
  trends: RotationItem[];
  competitor: RotationItem[];
  newsletter: RotationItem[];
}

function RotationTable({ title, items }: { title: string; items: RotationItem[] }) {
  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No items configured.</p>
      ) : (
        <>
        <div className="space-y-2 md:hidden">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-[hsl(var(--border))] p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{item.name}</p>
                <span className="status-badge">
                  <Circle size={7} className={item.isActive ? 'fill-emerald-500 text-emerald-500' : 'fill-slate-400 text-slate-400'} />
                  {item.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                <span>Order: {item.rotationOrder}</span>
                <span className="text-right">
                  {item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleDateString() : 'Next in rotation'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="text-left py-2 font-medium">Name</th>
                <th className="text-left py-2 font-medium">Order</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-left py-2 font-medium">Last Used</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-[hsl(var(--border))] last:border-0">
                  <td className="py-3 font-medium">{item.name}</td>
                  <td className="py-3 text-[hsl(var(--muted-foreground))]">{item.rotationOrder}</td>
                  <td className="py-3">
                    <span className="flex items-center gap-1.5">
                      <Circle
                        size={8}
                        className={item.isActive ? 'fill-emerald-500 text-emerald-500' : 'fill-gray-400 text-gray-400'}
                      />
                      {item.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-3 text-[hsl(var(--muted-foreground))]">
                    {item.lastUsedAt
                      ? new Date(item.lastUsedAt).toLocaleString()
                      : <span className="text-brand-500 font-medium">Next in rotation</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

export default function RotationPage() {
  const [data, setData] = useState<RotationData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError('');
    api<{ data: RotationData }>('/dashboard/rotation')
      .then((res) => setData(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <AuthGuard>
      <div className="page-container">
        <div className="page-header">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <RotateCcw size={24} />
              Rotation Status
            </h1>
            <p className="text-[hsl(var(--muted-foreground))] mt-1">
              Entities with null last_used_at are next in rotation. Only updated after confirmed publish.
            </p>
          </div>
          <ProcessingButton loading={loading} loadingText="Refreshing…" onClick={load} variant="secondary" icon={<RotateCcw size={14} />}>
            Refresh
          </ProcessingButton>
        </div>

        {loading && !data ? (
          <div className="space-y-4">
            {[1, 2, 3].map((item) => <Skeleton key={item} className="h-44 w-full" />)}
          </div>
        ) : error ? (
          <div className="card border-red-500/30 text-sm space-y-3">
            <p className="text-red-500 font-medium">{error}</p>
            <button type="button" onClick={load} className="btn-primary">Retry</button>
          </div>
        ) : data ? (
          <div className="space-y-6">
            <RotationTable title="Industry / Topics" items={data.trends} />
            <RotationTable title="Competitors" items={data.competitor} />
            <RotationTable title="Product Newsletter" items={data.newsletter || []} />
          </div>
        ) : null}
      </div>
    </AuthGuard>
  );
}

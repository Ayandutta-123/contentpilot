'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { ProcessingButton } from '@/components/ui';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="card w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
          <AlertTriangle size={22} />
        </div>
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          This screen could not finish loading. Your saved data is unchanged.
        </p>
        <ProcessingButton className="mt-5 w-full" onClick={reset} icon={<RefreshCw size={16} />}>
          Try again
        </ProcessingButton>
      </div>
    </div>
  );
}

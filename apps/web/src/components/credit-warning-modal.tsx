'use client';

import { Wallet } from 'lucide-react';
import type { CreditAlertPayload } from '@/lib/credit-alert';

export function CreditWarningModal({
  alert,
  onOk,
}: {
  alert: CreditAlertPayload;
  onOk: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/50 p-4 backdrop-blur-[2px] sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="credit-warning-title"
      aria-describedby="credit-warning-body"
    >
      <div className="w-full max-w-md rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-2xl animate-scale-in">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <Wallet size={22} />
          </div>
          <div className="min-w-0 pt-0.5">
            <p id="credit-warning-title" className="text-base font-semibold">
              {alert.title}
            </p>
            <p
              id="credit-warning-body"
              className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]"
            >
              {alert.message}
            </p>
            <a
              href={alert.billingUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex text-sm font-medium text-brand-600 underline"
            >
              Open billing
            </a>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="button" className="btn-primary min-h-[44px] min-w-[96px] px-5" onClick={onOk}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

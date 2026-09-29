'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/**
 * Bottom-of-page CTA when generation finished (or timed out) but the user
 * is still on the engine page. Prefer auto-redirect via waitThenOpenApproval;
 * this is the fallback so the link is never in the top status banner.
 */
export function ApprovalReadyFooter({
  contentId,
  generating,
  label = 'Open in Approvals',
}: {
  contentId?: string | null;
  generating?: boolean;
  label?: string;
}) {
  if (!contentId || generating) return null;
  return (
    <div className="sticky-mobile-cta sticky z-30 -mx-1 mt-6 border-t border-[hsl(var(--border))] bg-[hsl(var(--background))]/95 px-1 py-4 backdrop-blur-md bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:static md:bottom-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
      <div className="flex flex-col gap-2 rounded-2xl border border-brand-500/25 bg-brand-500/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Draft ready for review</p>
          <p className="mt-0.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            Open the approval editor to edit caption, creative, and publish.
          </p>
        </div>
        <Link
          href={`/approvals/${contentId}`}
          className="btn-primary inline-flex min-h-[44px] w-full shrink-0 items-center justify-center gap-1.5 px-5 sm:w-auto"
        >
          {label}
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}

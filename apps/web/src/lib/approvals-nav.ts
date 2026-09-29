import { api } from '@/lib/api';

/** Navigate to the approval editor for a generated post. */
export function goToApprovalEditor(contentId: string): void {
  if (typeof window === 'undefined' || !contentId) return;
  window.location.assign(`/approvals/${contentId}`);
}

export type WaitForApprovalResult =
  | { outcome: 'ready'; contentId: string }
  | { outcome: 'aborted' }
  | { outcome: 'failed'; error: string }
  | { outcome: 'timeout'; contentId: string };

/**
 * Poll until content is pending_approval, then the caller should redirect.
 * Prefer `waitThenOpenApproval` for the default UX.
 */
export async function waitForApprovalReady(
  contentId: string,
  opts: {
    signal?: AbortSignal;
    /** Default 3 minutes */
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<WaitForApprovalResult> {
  const timeoutMs = opts.timeoutMs ?? 3 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 2500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const status = await api<{
      data: { status: string; publishError?: string | null };
    }>(`/content/${contentId}`, { signal: opts.signal });

    if (status.data.status === 'pending_approval') {
      return { outcome: 'ready', contentId };
    }
    if (status.data.status === 'rejected') {
      return { outcome: 'aborted' };
    }
    if (status.data.status === 'failed') {
      return {
        outcome: 'failed',
        error: status.data.publishError || 'Generation failed',
      };
    }
  }
  return { outcome: 'timeout', contentId };
}

/**
 * Wait for generation, then auto-open the approval editor.
 * On timeout, returns without redirect so the page can show a bottom CTA.
 */
export async function waitThenOpenApproval(
  contentId: string,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<WaitForApprovalResult> {
  const result = await waitForApprovalReady(contentId, opts);
  if (result.outcome === 'ready') {
    goToApprovalEditor(result.contentId);
  }
  return result;
}

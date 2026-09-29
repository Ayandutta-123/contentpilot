/** True when fetch/api was cancelled via AbortController. */
export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return true;
  }
  if (err instanceof Error && (err.name === 'AbortError' || /aborted|abort/i.test(err.message))) {
    return true;
  }
  return false;
}

/** Soft-cancel a queued generation (marks rejected + drops Bull job when possible). */
export async function abortContentGeneration(contentId: string): Promise<void> {
  const { api } = await import('./api');
  await api(`/content/${contentId}/abort`, {
    method: 'POST',
    body: { reason: 'Aborted by user while generating' },
  });
}

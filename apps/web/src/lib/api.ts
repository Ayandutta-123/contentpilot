import { emitCreditAlert, isCreditAlert, PROVIDER_CREDITS_CODE } from '@/lib/credit-alert';

const API_BASE = '/api';

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: unknown;

  constructor(message: string, status: number, extra?: { code?: string; data?: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = extra?.code;
    this.data = extra?.data;
  }
}

type ErrorListener = (
  message: string,
  path?: string,
  status?: number,
  extra?: { code?: string; data?: unknown },
) => void;
let errorListener: ErrorListener | null = null;

export function onApiError(listener: ErrorListener) {
  errorListener = listener;
  return () => {
    if (errorListener === listener) errorListener = null;
  };
}

function isTransientApiMessage(message: string): boolean {
  return /unreachable|restarting|ECONNREFUSED|ECONNRESET|socket hang up|Failed to fetch|NetworkError|proxy/i.test(
    message,
  );
}

function shouldNotifyError(path: string, status: number, message: string): boolean {
  if (status === 429) return false;
  if (path.startsWith('/notifications')) return false;
  if (path.startsWith('/auth/me')) return false;
  // Background poll endpoints — never spam the bell / Cursor Issues for these
  if (path.startsWith('/content/trends/discover/')) return false;
  if (path.startsWith('/content/competitors/scrape/')) return false;
  if (/rate limit/i.test(message)) return false;
  // Brief API restarts during local `tsx watch` — don't create red issue cards
  if (status >= 500 && isTransientApiMessage(message)) return false;
  return status >= 400;
}

export async function api<T = unknown>(path: string, options: FetchOptions = {}): Promise<T> {
  const { body, ...rest } = options;
  const hasBody = body !== undefined && body !== null;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...rest.headers,
      },
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Convert raw network failures into ApiError so callers get a clean message
    // (and background polls don't dump opaque TypeErrors into the console as often).
    const raw = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      isTransientApiMessage(raw)
        ? 'API server unreachable or restarting. Wait a few seconds and refresh.'
        : raw || 'Network request failed',
      503,
    );
  }

  if (rest.signal?.aborted) {
    const abortErr = new DOMException('Aborted', 'AbortError');
    throw abortErr;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const payload = data as {
      error?: string;
      message?: string;
      code?: string;
      data?: unknown;
      meta?: { code?: string; creditAlert?: unknown };
    };
    if (payload.code === PROVIDER_CREDITS_CODE && isCreditAlert(payload.data)) {
      emitCreditAlert(payload.data);
    }
    const fromBody = payload.error ?? payload.message;
    // Next.js rewrite proxy returns empty/HTML 500 when the API is down or restarting
    const message =
      fromBody ||
      (res.status >= 500
        ? 'API server unreachable or restarting. Wait a few seconds and refresh.'
        : `Request failed (${res.status})`);
    const isCredits = payload.code === PROVIDER_CREDITS_CODE;
    if (errorListener && shouldNotifyError(path, res.status, message) && !isCredits) {
      errorListener(message, path, res.status, { code: payload.code, data: payload.data });
    }
    throw new ApiError(message, res.status, { code: payload.code, data: payload.data });
  }
  const ok = data as {
    meta?: { code?: string; creditAlert?: unknown };
    data?: { creditAlert?: unknown };
  };
  if (ok.meta?.code === PROVIDER_CREDITS_CODE && isCreditAlert(ok.meta.creditAlert)) {
    emitCreditAlert(ok.meta.creditAlert);
  } else if (ok.data && isCreditAlert(ok.data.creditAlert)) {
    emitCreditAlert(ok.data.creditAlert);
  }
  return data as T;
}

export async function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(
      isTransientApiMessage(raw)
        ? 'API server unreachable or restarting. Wait a few seconds and refresh.'
        : raw || 'Upload failed',
    );
  }
  if (options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const payload = data as { error?: string; code?: string; data?: unknown };
    if (payload.code === PROVIDER_CREDITS_CODE && isCreditAlert(payload.data)) {
      emitCreditAlert(payload.data);
    }
    const message = payload.error ?? `Upload failed (${res.status})`;
    if (
      errorListener &&
      !/rate limit/i.test(message) &&
      payload.code !== PROVIDER_CREDITS_CODE &&
      !(res.status >= 500 && isTransientApiMessage(message))
    ) {
      errorListener(message, path, res.status);
    }
    throw new Error(message);
  }
  return data as T;
}

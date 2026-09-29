export const MAX_REVISION_CYCLES = 5;
export const PUBLISH_POLL_INTERVAL_MS = 5000;
export const PUBLISH_POLL_MAX_ATTEMPTS = 6;
export const LLM_MAX_TOKENS = 4096;
export const RATE_LIMIT_WINDOW_MS = 900_000;
export const RATE_LIMIT_MAX_REQUESTS = 100;
export const MEDIA_SIGNED_URL_TTL_SECONDS = 3600;

export const CHARACTER_LIMITS = {
  headline: 120,
  body: 2200,
  callToAction: 100,
  /** Art-direction brief for the image model — keep generous so Fable can be highly detailed */
  imagePrompt: 8000,
  sourceAttribution: 200,
  hashtag: 50,
  maxHashtags: 30,
} as const;

export const WS_EVENTS = {
  CONTENT_STATUS_CHANGED: 'content:status_changed',
  APPROVAL_PENDING: 'approval:pending',
  EXECUTION_LOG: 'execution:log',
  ROTATION_UPDATED: 'rotation:updated',
} as const;

export const QUEUE_NAMES = {
  CONTENT_GENERATION: 'content-generation',
  CONTENT_PUBLISHING: 'content-publishing',
  NOTIFICATIONS: 'notifications',
  TOKEN_REFRESH: 'token-refresh',
} as const;

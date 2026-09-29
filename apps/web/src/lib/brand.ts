/** Public brand strings — set via NEXT_PUBLIC_* so deploys can white-label without code changes. */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'ContentPilot';
export const APP_TAGLINE = process.env.NEXT_PUBLIC_APP_TAGLINE || 'Content Engine';
export const APP_DESCRIPTION =
  process.env.NEXT_PUBLIC_APP_DESCRIPTION ||
  'Configurable multi-platform content automation engine';

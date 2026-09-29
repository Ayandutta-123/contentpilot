'use client';

import type { SVGProps } from 'react';

export type SocialPlatform =
  | 'instagram'
  | 'linkedin'
  | 'facebook'
  | 'twitter'
  | 'x'
  | string;

const LABELS: Record<string, string> = {
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  twitter: 'X / Twitter',
  x: 'X / Twitter',
};

/** Official-ish brand colors for chips / icons (readable on light + dark UI). */
const BRAND: Record<string, { fg: string; bg: string; ring: string }> = {
  instagram: {
    fg: '#E1306C',
    bg: 'rgba(225, 48, 108, 0.12)',
    ring: 'rgba(225, 48, 108, 0.28)',
  },
  linkedin: {
    fg: '#0A66C2',
    bg: 'rgba(10, 102, 194, 0.12)',
    ring: 'rgba(10, 102, 194, 0.28)',
  },
  facebook: {
    fg: '#1877F2',
    bg: 'rgba(24, 119, 242, 0.12)',
    ring: 'rgba(24, 119, 242, 0.28)',
  },
  twitter: {
    fg: '#0F1419',
    bg: 'rgba(15, 20, 25, 0.08)',
    ring: 'rgba(15, 20, 25, 0.2)',
  },
  x: {
    fg: '#0F1419',
    bg: 'rgba(15, 20, 25, 0.08)',
    ring: 'rgba(15, 20, 25, 0.2)',
  },
};

export function normalizePlatform(platform?: string | null): string {
  const p = (platform || '').trim().toLowerCase();
  if (p === 'x' || p === 'x.com' || p === 'twitter.com') return 'twitter';
  if (p === 'ig' || p === 'insta') return 'instagram';
  if (p === 'fb' || p === 'meta') return 'facebook';
  if (p === 'li' || p === 'linked-in') return 'linkedin';
  return p;
}

export function formatPlatformLabel(platform?: string | null): string {
  const key = normalizePlatform(platform);
  return LABELS[key] || (platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Channel');
}

function IconSvg({
  children,
  size = 16,
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function InstagramGlyph({ size = 16, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <IconSvg size={size} {...rest}>
      <path d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4c0 3.2-2.6 5.8-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8C2 4.6 4.6 2 7.8 2zm-.2 2C5.61 4 4 5.61 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8c1.99 0 3.6-1.61 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4H7.6zM12 7a5 5 0 110 10 5 5 0 010-10zm0 2a3 3 0 100 6 3 3 0 000-6zm5.25-2.75a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5z" />
    </IconSvg>
  );
}

export function LinkedInGlyph({ size = 16, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <IconSvg size={size} {...rest}>
      <path d="M4.98 3.5C4.98 4.88 3.88 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8.5h4V23h-4V8.5zM8.5 8.5h3.84v1.98h.05c.53-1.01 1.84-2.08 3.79-2.08 4.05 0 4.8 2.67 4.8 6.14V23h-4v-6.6c0-1.57-.03-3.59-2.19-3.59-2.19 0-2.53 1.71-2.53 3.48V23h-4V8.5z" />
    </IconSvg>
  );
}

export function FacebookGlyph({ size = 16, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <IconSvg size={size} {...rest}>
      <path d="M22 12.07C22 6.48 17.52 2 11.93 2S1.86 6.48 1.86 12.07c0 5.02 3.66 9.18 8.44 9.93v-7.03H7.9v-2.9h2.4V9.84c0-2.37 1.4-3.68 3.56-3.68 1.03 0 2.11.18 2.11.18v2.32h-1.19c-1.17 0-1.54.73-1.54 1.48v1.78h2.62l-.42 2.9h-2.2V22c4.78-.75 8.44-4.91 8.44-9.93z" />
    </IconSvg>
  );
}

export function TwitterGlyph({ size = 16, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <IconSvg size={size} {...rest}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </IconSvg>
  );
}

export function PlatformIcon({
  platform,
  size = 16,
  className,
}: {
  platform?: string | null;
  size?: number;
  className?: string;
}) {
  const key = normalizePlatform(platform);
  if (key === 'instagram') return <InstagramGlyph size={size} className={className} />;
  if (key === 'linkedin') return <LinkedInGlyph size={size} className={className} />;
  if (key === 'facebook') return <FacebookGlyph size={size} className={className} />;
  if (key === 'twitter') return <TwitterGlyph size={size} className={className} />;
  return (
    <span
      className={`inline-flex items-center justify-center rounded text-[10px] font-bold uppercase ${className || ''}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {(platform || '?').slice(0, 1)}
    </span>
  );
}

type BadgeVariant = 'pill' | 'chip' | 'solid' | 'ghost' | 'icon';

/**
 * Prominent social channel badge — use wherever a platform name is shown.
 */
export function PlatformBadge({
  platform,
  variant = 'pill',
  size = 'md',
  showLabel = true,
  className = '',
}: {
  platform?: string | null;
  variant?: BadgeVariant;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}) {
  const key = normalizePlatform(platform);
  const label = formatPlatformLabel(platform);
  const brand = BRAND[key] || {
    fg: 'hsl(var(--foreground))',
    bg: 'hsl(var(--muted))',
    ring: 'hsl(var(--border))',
  };

  const iconSize = size === 'sm' ? 12 : size === 'lg' ? 18 : 14;
  const pad =
    size === 'sm'
      ? 'gap-1 px-1.5 py-0.5 text-[10px]'
      : size === 'lg'
        ? 'gap-2 px-3 py-1.5 text-[13px]'
        : 'gap-1.5 px-2 py-1 text-[11px]';

  if (variant === 'icon') {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-lg ${className}`}
        style={{
          width: size === 'lg' ? 40 : size === 'sm' ? 28 : 36,
          height: size === 'lg' ? 40 : size === 'sm' ? 28 : 36,
          color: brand.fg,
          background: brand.bg,
          boxShadow: `inset 0 0 0 1px ${brand.ring}`,
        }}
        title={label}
        aria-label={label}
      >
        <PlatformIcon platform={key} size={iconSize + 2} />
      </span>
    );
  }

  const solid = variant === 'solid';
  const ghost = variant === 'ghost';

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full font-semibold tracking-tight ${pad} ${className}`}
      style={
        solid
          ? { color: '#fff', background: brand.fg }
          : ghost
            ? {
                color: brand.fg,
                background: 'transparent',
                boxShadow: `inset 0 0 0 1px ${brand.ring}`,
              }
            : {
                color: brand.fg,
                background: brand.bg,
                boxShadow: `inset 0 0 0 1px ${brand.ring}`,
              }
      }
      title={label}
    >
      <PlatformIcon platform={key} size={iconSize} />
      {showLabel ? <span className="truncate">{label}</span> : null}
    </span>
  );
}

/** Compact row of channel badges. */
export function PlatformBadgeList({
  platforms,
  size = 'sm',
  className = '',
}: {
  platforms: Array<string | null | undefined>;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const unique = [
    ...new Set(platforms.map((p) => normalizePlatform(p)).filter(Boolean)),
  ];
  if (!unique.length) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {unique.map((p) => (
        <PlatformBadge key={p} platform={p} size={size} />
      ))}
    </span>
  );
}

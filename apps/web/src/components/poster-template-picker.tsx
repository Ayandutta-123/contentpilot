'use client';

import { Check, Lock } from 'lucide-react';

export type PosterBlockRule = 'required' | 'optional' | 'omit';

export type PosterTemplate = {
  id: string;
  playId: string;
  label: string;
  tagline: string;
  layout:
    | 'hero_right'
    | 'hero_top'
    | 'editorial_left'
    | 'center_stage'
    | 'split_band'
    | 'sale_circles'
    | 'sale_split'
    | 'uploaded_master';
  fillLayout?: PosterTemplate['layout'];
  blocks: {
    eyebrow: PosterBlockRule;
    subhead: PosterBlockRule;
    pillars: 0 | 2 | 3;
    stat: PosterBlockRule;
    callout: PosterBlockRule;
    closing: PosterBlockRule;
    footer: PosterBlockRule;
  };
  headlineWords: [number, number];
  copyRules: string[];
  artDirection: string;
  accentRole: 'stat' | 'headline' | 'band' | 'rule';
  previewUrl?: string;
  sourceImageUrl?: string;
  origin?: 'upload' | 'builtin';
};

export type BrandKitPreview = {
  mode: 'strict' | 'mix' | 'sometimes' | 'off';
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  fonts: { heading: string; body: string };
};

export const FALLBACK_KIT: BrandKitPreview = {
  mode: 'mix',
  colors: {
    primary: '#0B1F3A',
    secondary: '#1E3A5F',
    accent: '#E23A2E',
    background: '#0B1220',
    text: '#F7F4EE',
  },
  fonts: { heading: 'modern', body: 'sans' },
};

const FACE = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

function hexLum(hex: string): number {
  const n = hex.replace('#', '');
  const v = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return 0.5;
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function paperInk(kit: BrandKitPreview): string {
  return hexLum(kit.colors.text) > 0.55 ? kit.colors.primary : kit.colors.text;
}

function onAccent(accent: string): string {
  return hexLum(accent) < 0.45 ? '#FFFFFF' : '#111111';
}

function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const n = hex.replace('#', '');
    const v = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
    if (!/^[0-9a-fA-F]{6}$/.test(v)) return [128, 128, 128];
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(mix(ar, br))}${h(mix(ag, bg))}${h(mix(ab, bb))}`;
}

function PersonCutout({
  id,
  cx,
  cy,
  r,
  accent,
  variant,
}: {
  id: string;
  cx: number;
  cy: number;
  r: number;
  accent: string;
  variant: 'woman' | 'man';
}) {
  const clip = `${id}-cut`;
  const warm = `color-mix(in srgb, ${accent} 35%, #e8b84a)`;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 3} fill={warm} />
      <clipPath id={clip}>
        <circle cx={cx} cy={cy} r={r} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={warm} />
        {variant === 'woman' ? (
          <>
            <ellipse cx={cx} cy={cy + r * 0.55} rx={r * 0.72} ry={r * 0.85} fill="#f3efe6" />
            <ellipse cx={cx} cy={cy - r * 0.18} rx={r * 0.42} ry={r * 0.48} fill="#e8c9a0" />
            <ellipse cx={cx} cy={cy - r * 0.42} rx={r * 0.5} ry={r * 0.28} fill="#c9a15b" />
            <path
              d={`M${cx - r * 0.38} ${cy - r * 0.15} Q ${cx} ${cy + r * 0.2} ${cx + r * 0.38} ${cy - r * 0.15}`}
              fill="#2a2118"
              opacity={0.85}
            />
          </>
        ) : (
          <>
            <rect x={cx - r * 0.55} y={cy + r * 0.05} width={r * 1.1} height={r * 0.95} rx={4} fill={accent} />
            <ellipse cx={cx} cy={cy - r * 0.12} rx={r * 0.36} ry={r * 0.4} fill="#d2a07a" />
            <rect x={cx - r * 0.22} y={cy + r * 0.12} width={r * 0.44} height={r * 0.28} fill="#f7f4ee" />
          </>
        )}
      </g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#fff" strokeWidth={3} />
    </g>
  );
}

function ShopperPanel({
  id,
  x,
  y,
  w,
  h,
  accent,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  accent: string;
}) {
  const clip = `${id}-photo`;
  const warm = `color-mix(in srgb, ${accent} 28%, #d4a24a)`;
  const cx = x + w * 0.52;
  const cy = y + h * 0.58;
  return (
    <g>
      <clipPath id={clip}>
        <rect x={x} y={y} width={w} height={h} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x={x} y={y} width={w} height={h} fill={warm} />
        <ellipse cx={x + w * 0.7} cy={y + h * 0.2} rx={w * 0.5} ry={h * 0.25} fill="#fff" opacity={0.18} />
        <ellipse cx={cx} cy={cy + h * 0.12} rx={w * 0.42} ry={h * 0.48} fill="#f1ead8" />
        <ellipse cx={cx} cy={cy - h * 0.22} rx={w * 0.22} ry={h * 0.16} fill="#e0b48a" />
        <path
          d={`M${cx - w * 0.2} ${cy - h * 0.18} Q ${cx + w * 0.08} ${cy - h * 0.02} ${cx + w * 0.24} ${cy - h * 0.22}`}
          fill="#5c3a22"
        />
        <rect x={cx + w * 0.12} y={cy - h * 0.02} width={w * 0.18} height={h * 0.28} rx={3} fill={accent} />
        <rect x={cx + w * 0.22} y={cy} width={w * 0.16} height={h * 0.26} rx={3} fill="#e8c14a" />
        <rect x={x} y={y} width={w} height={h * 0.22} fill="#000" opacity={0.22} />
        <rect x={x} y={y + h * 0.82} width={w} height={h * 0.18} fill="#000" opacity={0.28} />
      </g>
    </g>
  );
}

/**
 * Mini replica of the finished poster so the picker shows the real template,
 * not a wireframe — colours still come from the Brand Kit.
 */
function SaleCirclesThumb({ kit, uid }: { kit: BrandKitPreview; uid: string }) {
  const accent = kit.colors.accent;
  const ink = paperInk(kit);
  const light = onAccent(accent);
  const mustard = mixHex(accent, '#E8A317', 0.55);
  return (
    <svg
      viewBox="0 0 320 320"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Circle cutouts sale poster preview"
    >
      <defs>
        <clipPath id={`${uid}-arc`}>
          <circle cx={318} cy={210} r={148} />
        </clipPath>
      </defs>
      <rect width={320} height={320} rx={12} fill={accent} />
      <rect x={12} y={12} width={296} height={296} rx={6} fill="#F3F1EC" />
      <circle cx={318} cy={210} r={148} fill={mustard} clipPath={`url(#${uid}-arc)`} />
      <rect x={28} y={28} width={48} height={18} rx={3} fill={accent} />
      <text x={52} y={41} textAnchor="middle" fontFamily={FACE} fontSize={9} fontWeight={800} fill={light}>
        LOGO
      </text>
      <polygon points="30,58 40,72 20,72" fill="none" stroke={accent} strokeWidth={1.4} />
      <text x={28} y={108} fontFamily={FACE} fontSize={46} fontWeight={800} fill={accent} letterSpacing={-1.4}>
        SALE
      </text>
      <text x={28} y={134} fontFamily={FACE} fontSize={15} fontWeight={800} fill={ink}>
        New Collections
      </text>
      <text x={28} y={154} fontFamily={FACE} fontSize={7.5} fontWeight={500} fill={ink} opacity={0.7}>
        Best quality product at a
      </text>
      <text x={28} y={165} fontFamily={FACE} fontSize={7.5} fontWeight={500} fill={ink} opacity={0.7}>
        low price.
      </text>
      <text x={292} y={72} textAnchor="end" fontFamily={FACE} fontSize={24} fontWeight={800} fill={accent}>
        25%
      </text>
      <text x={292} y={96} textAnchor="end" fontFamily={FACE} fontSize={14} fontWeight={800} fill={accent}>
        OFF
      </text>
      <text
        x={278}
        y={88}
        textAnchor="end"
        fontFamily={FACE}
        fontSize={10}
        fontStyle="italic"
        fontWeight={600}
        fill={ink}
        transform="rotate(-8 278 88)"
      >
        Sale Bonus!
      </text>
      <PersonCutout id={`${uid}-w`} cx={248} cy={186} r={70} accent={accent} variant="woman" />
      <PersonCutout id={`${uid}-m`} cx={132} cy={236} r={42} accent={accent} variant="man" />
      <rect x={28} y={248} width={68} height={20} rx={5} fill={accent} />
      <text x={62} y={262} textAnchor="middle" fontFamily={FACE} fontSize={8} fontWeight={700} fill={light}>
        Shop Now
      </text>
      <rect x={28} y={280} width={12} height={12} rx={2} fill="none" stroke={ink} strokeWidth={1.4} />
      <path d="M31 286h6m-2-2.2 2.2 2.2-2.2 2.2" fill="none" stroke={ink} strokeWidth={1.3} strokeLinecap="round" />
      <text x={46} y={290} fontFamily={FACE} fontSize={7.5} fontWeight={800} fill={ink} letterSpacing={0.5}>
        WEBSITE GOES HERE
      </text>
      <circle cx={168} cy={268} r={3.5} fill={accent} />
    </svg>
  );
}

function SaleSplitThumb({ kit, uid }: { kit: BrandKitPreview; uid: string }) {
  const accent = kit.colors.accent;
  const ink = paperInk(kit);
  const light = onAccent(accent);
  return (
    <svg
      viewBox="0 0 320 320"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Split offer sale poster preview"
    >
      <rect width={320} height={320} fill={accent} />
      <rect x={14} y={14} width={148} height={292} fill="#fff" />
      <ShopperPanel id={uid} x={170} y={14} w={136} h={292} accent={accent} />
      <rect x={158} y={14} width={14} height={292} fill={accent} />
      <text x={26} y={36} fontFamily={FACE} fontSize={12} fontWeight={800} fill={accent} letterSpacing={1.2}>
        LOGO
      </text>
      <text x={26} y={50} fontFamily={FACE} fontSize={6} fontWeight={700} fill={ink} letterSpacing={1.4}>
        TAGLINE HERE
      </text>
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3, 4].map((c) => (
          <circle key={`${r}${c}`} cx={128 + c * 4.5} cy={26 + r * 4.5} r={0.8} fill={ink} opacity={0.3} />
        )),
      )}
      <text x={26} y={92} fontFamily={FACE} fontSize={28} fontWeight={800} fill={ink}>
        Big
      </text>
      <text x={26} y={124} fontFamily={FACE} fontSize={36} fontWeight={800} fill={accent}>
        Sale
      </text>
      <text x={26} y={154} fontFamily={FACE} fontSize={28} fontWeight={800} fill={ink}>
        Offer
      </text>
      <text x={26} y={182} fontFamily={FACE} fontSize={15} fontStyle="italic" fontWeight={600} fill={ink}>
        Get
      </text>
      <text x={26} y={218} fontFamily={FACE} fontSize={36} fontWeight={800} fill={accent}>
        75%
      </text>
      <text x={102} y={216} fontFamily={FACE} fontSize={13} fontWeight={800} fill={ink}>
        Off
      </text>
      <polygon points="138,188 150,196 138,204" fill={accent} />
      <rect x={26} y={236} width={72} height={18} rx={9} fill={accent} />
      <text x={62} y={248} textAnchor="middle" fontFamily={FACE} fontSize={7} fontWeight={800} fill={light}>
        ORDER NOW
      </text>
      <path d="M56 262l6-5 6 5" fill="none" stroke={accent} strokeWidth={1.8} strokeLinecap="round" />
      <circle cx={34} cy={288} r={8} fill={accent} />
      <text x={34} y={291} textAnchor="middle" fontFamily={FACE} fontSize={7} fill={light}>
        ☎
      </text>
      <text x={48} y={284} fontFamily={FACE} fontSize={5} fontWeight={700} fill={ink} letterSpacing={0.3}>
        CALL FOR MORE INFORMATION
      </text>
      <text x={48} y={296} fontFamily={FACE} fontSize={8} fontWeight={800} fill={accent}>
        +00 123 456 789
      </text>
      <text x={186} y={36} fontFamily={FACE} fontSize={6.5} fontWeight={700} fill={ink} letterSpacing={1.2}>
        FOLLOW ON US
      </text>
      <circle cx={190} cy={52} r={7} fill={accent} />
      <circle cx={208} cy={52} r={7} fill={accent} />
      <circle cx={226} cy={52} r={7} fill={accent} />
      <text x={190} y={54.5} textAnchor="middle" fontFamily={FACE} fontSize={7} fill={light}>
        f
      </text>
      <text x={208} y={54.5} textAnchor="middle" fontFamily={FACE} fontSize={7} fill={light}>
        o
      </text>
      <text x={226} y={54.5} textAnchor="middle" fontFamily={FACE} fontSize={7} fill={light}>
        x
      </text>
      <circle cx={190} cy={288} r={7} fill={accent} />
      <text x={204} y={286} fontFamily={FACE} fontSize={6} fontWeight={800} fill={accent} letterSpacing={0.5}>
        WWW.YOURWEBSITE.COM
      </text>
      <text x={204} y={298} fontFamily={FACE} fontSize={5.5} fontWeight={700} fill={accent} letterSpacing={0.6}>
        VISIT OUR WEBSITE
      </text>
    </svg>
  );
}

function OfferStageThumb({ kit }: { kit: BrandKitPreview }) {
  const accent = kit.colors.accent;
  const ink = onAccent(kit.colors.background);
  return (
    <svg
      viewBox="0 0 320 320"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Stage offer poster preview"
    >
      <defs>
        <linearGradient id="stageFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={kit.colors.primary} />
          <stop offset="100%" stopColor={kit.colors.secondary} />
        </linearGradient>
      </defs>
      <rect width={320} height={320} fill="url(#stageFill)" />
      <circle cx={220} cy={90} r={90} fill={accent} opacity={0.28} />
      <text
        x={160}
        y={118}
        textAnchor="middle"
        fontFamily={FACE}
        fontSize={18}
        fontWeight={700}
        fill={accent}
        letterSpacing={3}
      >
        LIMITED OFFER
      </text>
      <text x={160} y={168} textAnchor="middle" fontFamily={FACE} fontSize={36} fontWeight={800} fill={ink}>
        50% OFF
      </text>
      <text x={160} y={196} textAnchor="middle" fontFamily={FACE} fontSize={12} fontWeight={600} fill={ink} opacity={0.8}>
        New season collection
      </text>
      <rect x={112} y={220} width={96} height={28} rx={14} fill={accent} />
      <text x={160} y={238} textAnchor="middle" fontFamily={FACE} fontSize={10} fontWeight={800} fill={onAccent(accent)}>
        Shop Now
      </text>
    </svg>
  );
}

function TemplateThumb({ template, kit }: { template: PosterTemplate; kit: BrandKitPreview }) {
  const W = 120;
  const H = 150;
  const ground = kit.colors.background;
  const ink = kit.colors.text;
  const accent = kit.colors.accent;
  const art = kit.colors.secondary;
  const { layout, blocks } = template;

  if (template.previewUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={template.previewUrl}
        alt={template.label}
        className="absolute inset-0 size-full object-cover"
      />
    );
  }

  if (layout === 'sale_circles') return <SaleCirclesThumb kit={kit} uid={template.id} />;
  if (layout === 'sale_split') return <SaleSplitThumb kit={kit} uid={template.id} />;
  if (template.id === 'offer_stage') return <OfferStageThumb kit={kit} />;

  // Same geometry the renderer uses, scaled down.
  const artRect =
    layout === 'hero_right'
      ? { x: W * 0.44, y: 0, w: W * 0.56, h: H * 0.66 }
      : layout === 'hero_top'
        ? { x: 0, y: 0, w: W, h: H * 0.42 }
        : layout === 'editorial_left'
          ? { x: 0, y: 0, w: W * 0.52, h: H }
          : layout === 'split_band'
            ? { x: 0, y: 0, w: W, h: H * 0.44 }
            : { x: 0, y: 0, w: W, h: H };

  const pad = 9;
  const colX = layout === 'editorial_left' ? W * 0.5 + 4 : pad;
  const colW =
    layout === 'hero_right'
      ? W * 0.56 - pad
      : layout === 'editorial_left'
        ? W * 0.5 - 8
        : W - pad * 2;
  const centered = layout === 'center_stage';
  const cx = centered ? W / 2 : colX;
  const bar = (w: number, y: number, h: number, fill: string, o = 1) => (
    <rect
      key={`${y}-${w}-${fill}`}
      x={centered ? cx - w / 2 : colX}
      y={y}
      width={w}
      height={h}
      rx={h / 2}
      fill={fill}
      opacity={o}
    />
  );

  const rows: React.ReactNode[] = [];
  let y = layout === 'split_band' ? artRect.h + 7 : pad;

  // Logo lockup
  rows.push(bar(colW * 0.34, y, 3, ink, 0.75));
  y += 8;
  if (centered) y += 14;

  if (blocks.eyebrow !== 'omit') {
    rows.push(bar(colW * 0.3, y, 2.5, accent));
    y += 6;
  }
  // Headline: two heavier bars
  rows.push(bar(colW * 0.92, y, 5, ink));
  y += 7;
  rows.push(
    bar(colW * 0.62, y, 5, template.accentRole === 'headline' ? accent : ink, 0.95),
  );
  y += 8;
  if (blocks.subhead !== 'omit') {
    rows.push(bar(colW * 0.8, y, 2.5, ink, 0.5));
    y += 5;
    rows.push(bar(colW * 0.55, y, 2.5, ink, 0.5));
    y += 7;
  }
  rows.push(bar(colW * 0.16, y, 2, accent));
  y += 8;

  // Pillars
  if (blocks.pillars > 0) {
    if (layout === 'editorial_left') {
      for (let i = 0; i < blocks.pillars; i++) {
        rows.push(
          <g key={`p${i}`}>
            <circle cx={colX + 2.5} cy={y + 2.5} r={2.5} fill={accent} />
            <rect x={colX + 8} y={y + 1} width={colW * 0.5} height={3} rx={1.5} fill={ink} />
            <rect
              x={colX + 8}
              y={y + 6}
              width={colW * 0.72}
              height={2}
              rx={1}
              fill={ink}
              opacity={0.45}
            />
          </g>,
        );
        y += 13;
      }
    } else {
      const gap = 4;
      const pw = (colW - gap * (blocks.pillars - 1)) / blocks.pillars;
      for (let i = 0; i < blocks.pillars; i++) {
        const px = colX + i * (pw + gap);
        rows.push(
          <g key={`p${i}`}>
            <circle cx={px + 3} cy={y + 3} r={3} fill={accent} />
            <rect x={px} y={y + 9} width={pw * 0.8} height={3} rx={1.5} fill={ink} />
            <rect x={px} y={y + 14} width={pw} height={2} rx={1} fill={ink} opacity={0.45} />
            <rect x={px} y={y + 18} width={pw * 0.7} height={2} rx={1} fill={ink} opacity={0.45} />
          </g>,
        );
      }
      y += 26;
    }
  }

  // Stat badge + callout row, anchored to the bottom like the renderer does.
  const hasStat = blocks.stat !== 'omit';
  const hasCallout = blocks.callout !== 'omit';
  const bottomRow: React.ReactNode[] = [];
  if (hasStat || hasCallout) {
    const rowY = H - pad - 18;
    const statW = hasStat ? colW * (hasCallout ? 0.3 : 0.44) : 0;
    const startX = centered ? cx - (statW + (hasCallout ? 4 + colW * 0.66 : 0)) / 2 : colX;
    if (hasStat) {
      bottomRow.push(
        <g key="stat">
          <rect x={startX} y={rowY} width={statW} height={18} rx={3} fill={accent} />
          <rect
            x={startX + 4}
            y={rowY + 5}
            width={statW - 12}
            height={5}
            rx={2}
            fill={ground}
            opacity={0.85}
          />
        </g>,
      );
    }
    if (hasCallout) {
      const calloutX = startX + (hasStat ? statW + 4 : 0);
      const calloutW = colW - (hasStat ? statW + 4 : 0);
      bottomRow.push(
        <g key="callout">
          <rect
            x={calloutX}
            y={rowY}
            width={calloutW}
            height={18}
            rx={3}
            fill={ink}
            opacity={0.1}
          />
          <rect x={calloutX + 4} y={rowY + 4} width={calloutW * 0.4} height={3} rx={1.5} fill={ink} />
          <rect
            x={calloutX + 4}
            y={rowY + 11}
            width={calloutW * 0.72}
            height={2}
            rx={1}
            fill={ink}
            opacity={0.5}
          />
        </g>,
      );
    }
  } else if (blocks.closing !== 'omit') {
    bottomRow.push(
      <rect
        key="closing"
        x={centered ? cx - colW * 0.2 : colX}
        y={H - pad - 4}
        width={colW * 0.4}
        height={3}
        rx={1.5}
        fill={accent}
      />,
    );
  }

  const gradId = `thumb-${template.id}`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full"
      role="img"
      aria-label={`${template.label} layout preview`}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={art} stopOpacity="0.95" />
          <stop offset="100%" stopColor={kit.colors.primary} stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={ground} />
      <rect
        x={artRect.x}
        y={artRect.y}
        width={artRect.w}
        height={artRect.h}
        fill={`url(#${gradId})`}
        opacity={layout === 'center_stage' ? 0.45 : 1}
      />
      {layout === 'split_band' && (
        <rect x={0} y={artRect.h - 2} width={W} height={2.5} fill={accent} />
      )}
      {rows}
      {bottomRow}
    </svg>
  );
}

function blockSummary(t: PosterTemplate): string {
  const parts: string[] = [];
  if (t.blocks.pillars) parts.push(`${t.blocks.pillars} points`);
  if (t.blocks.stat === 'required') parts.push('needs a number');
  else if (t.blocks.stat === 'optional') parts.push('optional stat');
  if (t.blocks.callout !== 'omit') parts.push('callout');
  if (!parts.length) parts.push('minimal copy');
  return parts.join(' · ');
}

export function PosterTemplatePicker({
  templates,
  kit,
  selectedId,
  onSelect,
  disabled,
}: {
  templates: PosterTemplate[];
  kit: BrandKitPreview;
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  if (!templates.length) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {templates.map((t) => {
        const on = selectedId === t.id;
        return (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(t.id)}
            aria-pressed={on}
            className={`group flex flex-col overflow-hidden rounded-2xl border-2 text-left transition-all active:scale-[0.99] disabled:opacity-60 ${
              on
                ? 'border-brand-600 shadow-lg shadow-brand-600/15 ring-1 ring-brand-500/25'
                : 'border-[hsl(var(--border))] hover:border-brand-500/40 hover:-translate-y-0.5 hover:shadow-md'
            }`}
          >
            <div
              className={`relative w-full overflow-hidden border-b border-[hsl(var(--border))] ${
                t.playId === 'offer' || t.origin === 'upload' ? 'aspect-square' : 'aspect-[4/5]'
              }`}
            >
              <TemplateThumb template={t} kit={kit} />
              {on && (
                <span className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full bg-brand-600 text-white shadow">
                  <Check size={13} />
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold leading-snug">{t.label}</p>
                <span className="flex shrink-0 items-center gap-1" aria-hidden>
                  {(['primary', 'accent', 'background'] as const).map((k) => (
                    <span
                      key={k}
                      className="size-2.5 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: kit.colors[k] }}
                    />
                  ))}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                {t.origin === 'upload'
                  ? 'Exact finished look — Brand Kit + your text fill this plate.'
                  : t.tagline}
              </p>
              <p className="mt-auto pt-2 text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {blockSummary(t)}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Three miniature layouts on a format card — so the user sees the templates before picking. */
export function PosterTemplateStrip({
  templates,
  kit,
}: {
  templates: PosterTemplate[];
  kit: BrandKitPreview;
}) {
  if (!templates.length) return null;
  return (
    <div className="mt-3 grid grid-cols-3 gap-1">
      {templates.slice(0, 3).map((t) => (
        <div
          key={t.id}
          className="overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]"
          title={t.label}
        >
          <div className="aspect-square relative">
            <TemplateThumb template={t} kit={kit} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Explains that a chosen template is enforced, and where the colours come from. */
export function TemplateLockNote({ template }: { template: PosterTemplate }) {
  if (template.origin === 'upload' || template.previewUrl) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-brand-500/25 bg-brand-500/[0.06] p-3">
        <Lock size={14} className="mt-0.5 shrink-0 text-brand-600" />
        <div className="min-w-0 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
          <span className="font-semibold text-[hsl(var(--foreground))]">
            Exact finished look — Brand Kit + your text fill this plate.
          </span>{' '}
          Layout stays locked to your uploaded master. Only logo, colours, fonts, copy, and photo
          slots change.
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-brand-500/25 bg-brand-500/[0.06] p-3">
      <Lock size={14} className="mt-0.5 shrink-0 text-brand-600" />
      <div className="min-w-0 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
        <span className="font-semibold text-[hsl(var(--foreground))]">
          {template.label} is locked.
        </span>{' '}
        The AI writes only the blocks this layout renders
        {template.blocks.pillars ? ` (including exactly ${template.blocks.pillars} points)` : ''}
        {template.blocks.stat === 'required'
          ? ', and it needs a real number from your brief — it will ask rather than invent one'
          : ''}
        . Colours and fonts come from your{' '}
        <span className="font-medium text-[hsl(var(--foreground))]">Brand Kit</span> in Settings.
      </div>
    </div>
  );
}

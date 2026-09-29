export type PlatformCaption = {
  headline: string;
  body: string;
  hashtags: string[];
  callToAction?: string | null;
};

export type PlatformCaptions = {
  instagram?: PlatformCaption;
  linkedin?: PlatformCaption;
  facebook?: PlatformCaption;
  twitter?: PlatformCaption;
};

/** Normalize hashtags from array or comma-separated string; strip #; drop junk. */
export function normalizeHashtags(v: unknown): string[] {
  const chunks: string[] = [];
  if (Array.isArray(v)) {
    for (const item of v) {
      chunks.push(...String(item).split(/[,]+/));
    }
  } else if (typeof v === 'string') {
    chunks.push(...v.split(/[,]+/));
  } else {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of chunks) {
    const t = raw.trim().replace(/^#+/, '').trim();
    // Drop empty / single-char leftovers from bad splits (e.g. "s" from "#API" + "APIs")
    if (!t || t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function asCaption(raw: unknown, fallback: PlatformCaption): PlatformCaption {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const o = raw as Record<string, unknown>;
  const headline =
    typeof o.headline === 'string' && o.headline.trim() ? o.headline.trim() : fallback.headline;
  const body = typeof o.body === 'string' && o.body.trim() ? o.body.trim() : fallback.body;
  const hashtags = normalizeHashtags(o.hashtags);
  const callToAction =
    typeof o.callToAction === 'string' ? o.callToAction : (fallback.callToAction ?? null);
  return {
    headline,
    body,
    hashtags: hashtags.length ? hashtags : fallback.hashtags,
    callToAction,
  };
}

function clipBody(body: string, maxChars: number): string {
  const trimmed = body.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars - 1);
  const atBreak = cut.lastIndexOf('\n\n');
  const atSentence = cut.search(/[.!?][^\n]*$/);
  let base = cut;
  if (atBreak > maxChars * 0.45) base = cut.slice(0, atBreak);
  else if (atSentence > maxChars * 0.45) base = cut.slice(0, atSentence + 1);
  else base = cut.replace(/\s+\S*$/, '').trim();
  return `${base.trim()}…`;
}

function firstBeats(body: string, maxChars: number): string {
  const parts = body
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return clipBody(body, maxChars);

  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const next = `${out}\n\n${parts[i]}`;
    if (next.length > maxChars) break;
    out = next;
    // Instagram: prefer 1–2 short beats
    if (out.length >= Math.min(220, maxChars * 0.7)) break;
  }
  return clipBody(out, maxChars);
}

function captionsLookSame(a: PlatformCaption, b: PlatformCaption): boolean {
  const strip = (s: string) => s.replace(/…$/u, '').trim();
  const ab = strip(a.body);
  const bb = strip(b.body);
  if (!ab || !bb) return true;
  if (ab === bb) return true;
  // Truncated-copy fallback (IG often ends with …)
  const shorter = ab.length <= bb.length ? ab : bb;
  const longer = ab.length <= bb.length ? bb : ab;
  return longer.startsWith(shorter) && longer.length - shorter.length < 120;
}

/** Derive a punchier Instagram variant from a LinkedIn-style caption. */
export function deriveInstagramCaption(base: PlatformCaption): PlatformCaption {
  const tags = normalizeHashtags(base.hashtags);
  const igTags =
    tags.length >= 6
      ? tags.slice(0, 10)
      : [...tags, 'SocialMedia', 'BuildInPublic', 'Tech'].filter(
          (t, i, arr) => arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i,
        ).slice(0, 8);

  const cta =
    base.callToAction && base.callToAction.trim()
      ? clipBody(base.callToAction.trim(), 90)
      : 'Double-tap if this resonates — or share with your team.';

  let body = firstBeats(base.body || '', 280);
  const liBody = (base.body || '').trim();
  // Guarantee a visible difference vs LinkedIn (short posts still need a distinct IG take)
  if (!body || body.replace(/…$/u, '').trim() === liBody.replace(/…$/u, '').trim()) {
    const sentence = liBody.split(/(?<=[.!?])\s+/)[0]?.trim() || liBody;
    if (sentence.length > 12 && sentence.length < liBody.length) {
      body = `${sentence}\n\n${cta}`;
    } else if (liBody.length > 140) {
      body = clipBody(liBody, 140);
    } else {
      body = `${liBody}\n\n${cta}`.trim();
    }
  }

  return {
    headline: clipBody(base.headline || 'New post', 72).replace(/…$/u, ''),
    body,
    hashtags: igTags,
    callToAction: cta,
  };
}

/** Derive a professional LinkedIn variant (fewer hashtags, full body). */
export function deriveLinkedInCaption(base: PlatformCaption): PlatformCaption {
  const tags = normalizeHashtags(base.hashtags).slice(0, 5);
  return {
    headline: base.headline || '',
    body: base.body || '',
    hashtags: tags,
    callToAction: base.callToAction ?? null,
  };
}

function finalizeCaption(c: PlatformCaption): PlatformCaption {
  return {
    headline: c.headline || '',
    body: c.body || '',
    hashtags: normalizeHashtags(c.hashtags),
    callToAction: c.callToAction ?? null,
  };
}

/** Build IG + LinkedIn caption variants from LLM intent (with safe fallbacks). */
export function buildPlatformCaptionsFromIntent(
  intent: Record<string, unknown>,
  fallback: PlatformCaption,
): PlatformCaptions {
  const nested =
    (intent.captions && typeof intent.captions === 'object' && !Array.isArray(intent.captions)
      ? (intent.captions as Record<string, unknown>)
      : null) ||
    (intent.platformCaptions &&
    typeof intent.platformCaptions === 'object' &&
    !Array.isArray(intent.platformCaptions)
      ? (intent.platformCaptions as Record<string, unknown>)
      : null);

  const base: PlatformCaption = finalizeCaption({
    headline: fallback.headline,
    body: fallback.body,
    hashtags: fallback.hashtags,
    callToAction: fallback.callToAction,
  });

  const liFallback = deriveLinkedInCaption(base);
  const igFallback = deriveInstagramCaption(base);

  let linkedin = finalizeCaption(asCaption(nested?.linkedin, liFallback));
  let instagram = finalizeCaption(asCaption(nested?.instagram, igFallback));

  // LLM often duplicates the same caption into both keys — force a real IG variant
  if (captionsLookSame(instagram, linkedin)) {
    instagram = deriveInstagramCaption(linkedin);
  }

  // Ensure hashtag style still differs even when bodies were distinct
  if (
    instagram.hashtags.join(',').toLowerCase() === linkedin.hashtags.join(',').toLowerCase() &&
    instagram.hashtags.length > 0
  ) {
    instagram = {
      ...instagram,
      hashtags: deriveInstagramCaption({ ...linkedin, hashtags: instagram.hashtags }).hashtags,
    };
    linkedin = {
      ...linkedin,
      hashtags: linkedin.hashtags.slice(0, Math.min(5, linkedin.hashtags.length || 5)),
    };
  }

  return { instagram, linkedin };
}

export function captionForPlatform(
  platform: string,
  content: {
    headline: string;
    body: string;
    hashtags: string[];
    callToAction?: string | null;
    platformCaptions?: unknown;
  },
): PlatformCaption {
  const base: PlatformCaption = finalizeCaption({
    headline: content.headline || '',
    body: content.body || '',
    hashtags: content.hashtags || [],
    callToAction: content.callToAction ?? null,
  });
  const map =
    content.platformCaptions &&
    typeof content.platformCaptions === 'object' &&
    !Array.isArray(content.platformCaptions)
      ? (content.platformCaptions as PlatformCaptions)
      : null;

  if (platform === 'instagram' && map?.instagram) {
    const cap = finalizeCaption({ ...base, ...map.instagram });
    if (map.linkedin && captionsLookSame(cap, finalizeCaption({ ...base, ...map.linkedin }))) {
      return deriveInstagramCaption(finalizeCaption({ ...base, ...map.linkedin }));
    }
    return cap;
  }
  if (platform === 'linkedin' && map?.linkedin) {
    return finalizeCaption({ ...base, ...map.linkedin });
  }
  if (platform === 'facebook' && map?.facebook) {
    return finalizeCaption({ ...base, ...map.facebook });
  }
  if ((platform === 'twitter' || platform === 'x') && map?.twitter) {
    return finalizeCaption({ ...base, ...map.twitter });
  }

  if (platform === 'instagram') return deriveInstagramCaption(base);
  if (platform === 'linkedin') return deriveLinkedInCaption(base);
  return base;
}

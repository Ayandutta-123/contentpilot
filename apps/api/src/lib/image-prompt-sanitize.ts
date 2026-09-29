/**
 * Clean / rebuild image prompts before sending to fal.
 * Exact-scrape mode used to store "Reference photo: … Metadata only" which
 * makes Approvals → Generate produce random unrelated art (no reference image attached).
 */

const METADATA_ONLY_RE =
  /metadata description of the reused competitor image only|we will reuse the competitor|exact scraped photo for the visual|reference photo:\s*/i;

export function isMetadataOnlyImagePrompt(prompt: string | null | undefined): boolean {
  const p = (prompt || '').trim();
  if (!p) return true;
  if (METADATA_ONLY_RE.test(p) && p.length < 900) return true;
  if (/^reference photo:/i.test(p) && /metadata description/i.test(p)) return true;
  return false;
}

/** Strip poisoned “reference / metadata only” lines; keep any real scene that follows. */
export function stripMetadataImagePromptNoise(prompt: string): string {
  return prompt
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !METADATA_ONLY_RE.test(l) && !/^reference photo:/i.test(l))
    .join('\n')
    .trim();
}

export function buildSceneFromPost(opts: {
  headline?: string | null;
  body?: string | null;
  brandType?: string | null;
  imageStyle?: string | null;
}): string {
  const headline = (opts.headline || '').trim() || 'brand social post';
  const body = (opts.body || '').trim().slice(0, 280);
  const style = (opts.imageStyle || '').trim();
  const b2c = String(opts.brandType || 'b2b').toLowerCase() === 'b2c';
  const lead = b2c
    ? `Bold consumer campaign photograph for: ${headline}.`
    : `Photorealistic LinkedIn B2B editorial photograph for: ${headline}.`;
  const parts = [
    lead,
    body ? `Story context: ${body}` : '',
    style ? `Brand visual style: ${style}.` : '',
    'Single clear subject, natural light, premium agency finish, calm negative space in one corner for a logo badge.',
    'No logos, no watermarks, no readable text, no UI chrome, no sci-fi robot/cyborg stock tropes unless the topic requires them.',
  ];
  return parts.filter(Boolean).join(' ');
}

/**
 * Prompt that should drive fal text-to-image.
 * Replaces metadata-only competitor prompts with a real scene brief from the post.
 */
export function resolveGenerationImagePrompt(opts: {
  userPrompt?: string | null;
  storedPrompt?: string | null;
  headline?: string | null;
  body?: string | null;
  brandType?: string | null;
  imageStyle?: string | null;
  /** When true, do not append extra post-topic lines (caller already locked topic). */
  exact?: boolean;
}): string {
  const raw = (opts.userPrompt || opts.storedPrompt || '').trim();
  let scene = raw;

  if (!scene || isMetadataOnlyImagePrompt(scene)) {
    const stripped = stripMetadataImagePromptNoise(raw);
    // Leftover "LinkedIn B2B social visual for: …" lines are too thin — rebuild a real scene.
    const thinTopicLine = /^linkedin b2b social visual for:|^bold consumer instagram visual for:/i.test(
      stripped,
    );
    scene =
      stripped.length > 120 && !thinTopicLine
        ? stripped
        : buildSceneFromPost({
            headline: opts.headline,
            body: opts.body,
            brandType: opts.brandType,
            imageStyle: opts.imageStyle,
          });
  } else {
    // Soft-clean: drop leading "Reference photo:" metadata lines if mixed in
    const stripped = stripMetadataImagePromptNoise(scene);
    if (stripped.length > 80) scene = stripped;
  }

  if (opts.exact) return scene.trim();

  // Non-exact: lightly ground on headline if the scene does not already mention it
  const headline = (opts.headline || '').trim();
  if (headline && !scene.toLowerCase().includes(headline.toLowerCase().slice(0, 40))) {
    return `${scene}\nPost topic lock: ${headline}.`.trim();
  }
  return scene.trim();
}

/**
 * FLUX-family encoders effectively use ~512 tokens. Keep the SCENE first and
 * budget the full fal prompt so style boilerplate does not displace the brief.
 */
export const DEFAULT_FAL_PROMPT_BUDGET_CHARS = 12000;

export function assembleFalPromptFrontLoaded(
  scene: string,
  extras: string[],
  maxChars = DEFAULT_FAL_PROMPT_BUDGET_CHARS,
): string {
  const head = scene.trim();
  const tailRaw = extras
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (maxChars <= 0) return (tailRaw ? `${head} ${tailRaw}` : head).trim();
  if (!head) return tailRaw.slice(0, maxChars);

  if (head.length >= maxChars) return head.slice(0, maxChars);
  const room = Math.max(240, maxChars - head.length - 1);
  const tail = tailRaw.slice(0, room);
  return tail ? `${head} ${tail}` : head;
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { ApiError, api, apiUpload } from '@/lib/api';
import { isAbortError } from '@/lib/abort';
import { downloadImageHighQuality } from '@/lib/download-image';
import {
  Ban,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { BackButton, InlineNotice, LoadingState, ProcessOverlay, ProcessingButton, Toggle } from '@/components/ui';
import { PlatformBadge } from '@/components/platform-badge';
import { notifyError, notifySuccess } from '@/lib/toast';
import { CREATIVE_MODE_LABELS } from '@/components/creative-mode-picker';

type TemplateLayer = {
  id: string;
  type: string;
  slot: string;
  fillMode: string;
  editable: boolean;
  fillType: string | null;
  fillHint: string | null;
  label: string;
};

type ConnectedPlatform = {
  id: string;
  platform: string;
  accountName: string;
};

type PlatformCaptionEdit = {
  headline: string;
  body: string;
  hashtags: string;
  callToAction: string;
};

type PlatformCaptionsMap = {
  instagram?: {
    headline: string;
    body: string;
    hashtags: string[];
    callToAction?: string | null;
  };
  linkedin?: {
    headline: string;
    body: string;
    hashtags: string[];
    callToAction?: string | null;
  };
  facebook?: {
    headline: string;
    body: string;
    hashtags: string[];
    callToAction?: string | null;
  };
  twitter?: {
    headline: string;
    body: string;
    hashtags: string[];
    callToAction?: string | null;
  };
};

interface ContentDetail {
  id: string;
  headline: string;
  body: string;
  hashtags: string[];
  callToAction: string | null;
  platformCaptions?: PlatformCaptionsMap | null;
  engine: string;
  status: string;
  revisionCount: number;
  imageUrl: string | null;
  imagePrompt: string | null;
  sourceReference: string | null;
  brandTemplateId: string | null;
  templateSlots: Record<string, string>;
  carousel?: {
    slideCount: number;
    slides: Array<{
      index: number;
      headline: string;
      imagePrompt: string;
      imageUrl: string;
      rawImageUrl?: string | null;
    }>;
  } | null;
  templateLayers: TemplateLayer[];
  templateName: string | null;
  connectedPlatforms: ConnectedPlatform[];
  targetPlatforms: string[];
  approvals?: Array<{
    action: string;
    feedback: string | null;
    createdAt: string;
    reviewer?: { name: string };
  }>;
}

type CalendarDraftGone = {
  planId: string;
  entryId: string;
  title: string;
  date: string;
  year: number;
  month: number;
};

type CaptionTab = 'instagram' | 'linkedin';

function emptyCaptionEdit(): PlatformCaptionEdit {
  return { headline: '', body: '', hashtags: '', callToAction: '' };
}

function normalizeHashtagList(hashtags: unknown): string[] {
  const chunks: string[] = [];
  if (Array.isArray(hashtags)) {
    for (const item of hashtags) chunks.push(...String(item).split(/[,]+/));
  } else if (typeof hashtags === 'string') {
    chunks.push(...hashtags.split(/[,]+/));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of chunks) {
    const t = raw.trim().replace(/^#+/, '').trim();
    if (!t || t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function captionFromFields(
  headline: string,
  body: string,
  hashtags: unknown,
  callToAction: string | null | undefined,
): PlatformCaptionEdit {
  return {
    headline: headline || '',
    body: body || '',
    // Always strip # for the editor — avoids "#Developers" looking like leading "s," when scrolled
    hashtags: normalizeHashtagList(hashtags).join(', '),
    callToAction: callToAction || '',
  };
}

function hydrateCaptionEditors(data: ContentDetail): Record<CaptionTab, PlatformCaptionEdit> {
  const legacy = captionFromFields(data.headline, data.body, data.hashtags || [], data.callToAction);
  const pc = data.platformCaptions;
  const linkedin = pc?.linkedin
    ? captionFromFields(
        pc.linkedin.headline,
        pc.linkedin.body,
        pc.linkedin.hashtags || [],
        pc.linkedin.callToAction,
      )
    : legacy;

  let instagram = pc?.instagram
    ? captionFromFields(
        pc.instagram.headline,
        pc.instagram.body,
        pc.instagram.hashtags || [],
        pc.instagram.callToAction,
      )
    : {
        ...legacy,
        body:
          legacy.body.length > 320
            ? `${legacy.body.split(/\n\n+/)[0] || legacy.body.slice(0, 300)}`.trim()
            : legacy.body,
        hashtags: normalizeHashtagList(legacy.hashtags).slice(0, 8).join(', '),
      };

  // If stored IG is just a truncated LinkedIn copy, show a clearer IG draft in the editor
  const igBody = instagram.body.replace(/…$/u, '').trim();
  const liBody = linkedin.body.trim();
  if (igBody && liBody && (liBody.startsWith(igBody) || igBody === liBody)) {
    const firstBeat = liBody.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)[0] || liBody;
    instagram = {
      ...instagram,
      body: firstBeat.length > 320 ? `${firstBeat.slice(0, 300).trim()}…` : firstBeat,
      hashtags:
        normalizeHashtagList(instagram.hashtags || linkedin.hashtags)
          .slice(0, 8)
          .join(', ') || linkedin.hashtags,
    };
  }

  return { instagram, linkedin };
}

function parseHashtags(raw: string): string[] {
  return normalizeHashtagList(raw);
}

function buildPlatformCaptionsPayload(edited: Record<CaptionTab, PlatformCaptionEdit>): PlatformCaptionsMap {
  const toVariant = (c: PlatformCaptionEdit) => ({
    headline: c.headline,
    body: c.body,
    hashtags: parseHashtags(c.hashtags),
    callToAction: c.callToAction || null,
  });
  return {
    instagram: toVariant(edited.instagram),
    linkedin: toVariant(edited.linkedin),
  };
}

const IMAGE_FORMATS = [
  { id: 'instagram_square', label: 'Instagram feed 1080×1080' },
  { id: 'instagram_portrait', label: 'Instagram portrait 1080×1350' },
  { id: 'linkedin', label: 'LinkedIn 1200×627' },
  { id: 'story', label: 'Story / Reels 1080×1920' },
] as const;

const VISUAL_STYLES = [
  { id: 'professional_photo', label: 'Professional photo', hint: 'Clean B2B photography' },
  { id: 'cinematic_photo', label: 'Cinematic photo', hint: 'Dramatic lighting' },
  { id: 'illustration', label: 'Illustration', hint: 'LinkedIn B2B editorial art' },
  { id: 'vector_flat', label: 'Vector / flat', hint: 'Clean geometric vector' },
  { id: '3d_render', label: '3D render', hint: 'Soft studio 3D' },
  { id: 'watercolor', label: 'Watercolor', hint: 'Artistic wash' },
  { id: 'line_art', label: 'Line art', hint: 'Minimal ink lines' },
  { id: 'editorial_collage', label: 'Editorial collage', hint: 'Magazine collage' },
  { id: 'meme_comic', label: 'Meme / comic', hint: 'Internet meme illustration' },
  { id: 'custom', label: 'Custom (prompt only)', hint: 'Follow your prompt / brand style' },
] as const;

const LOGO_PLACEMENTS = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
] as const;

const OVERLAY_FONTS = [
  { id: 'serif', label: 'Serif (editorial)' },
  { id: 'sans', label: 'Sans (clean)' },
  { id: 'display', label: 'Display (bold)' },
  { id: 'modern', label: 'Modern UI' },
] as const;

const canReview = (status: string) =>
  ['pending_approval', 'manual_intervention', 'generating'].includes(status);

export default function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatAction = searchParams.get('action'); // post | reject from Slack/Teams
  const [content, setContent] = useState<ContentDetail | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const [captionTab, setCaptionTab] = useState<CaptionTab>('linkedin');
  const [editedCaptions, setEditedCaptions] = useState<Record<CaptionTab, PlatformCaptionEdit>>({
    instagram: emptyCaptionEdit(),
    linkedin: emptyCaptionEdit(),
  });
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageFormat, setImageFormat] = useState<(typeof IMAGE_FORMATS)[number]['id']>('instagram_square');
  const [exactPrompt, setExactPrompt] = useState(false);
  /** When false, regenerate as full AI social image (no Brand Studio / Placid plate) */
  const [useTemplate, setUseTemplate] = useState(false);
  const [visualStyleId, setVisualStyleId] =
    useState<(typeof VISUAL_STYLES)[number]['id']>('professional_photo');
  const [logoPlacement, setLogoPlacement] =
    useState<(typeof LOGO_PLACEMENTS)[number]['id']>('top-left');
  const [headerText, setHeaderText] = useState('');
  const [footerCta, setFooterCta] = useState('');
  const [overlaysEnabled, setOverlaysEnabled] = useState(false);
  const [headerFontSize, setHeaderFontSize] = useState(46);
  const [footerFontSize, setFooterFontSize] = useState(28);
  const [headerFont, setHeaderFont] = useState<'serif' | 'sans' | 'display' | 'modern'>('serif');
  const [footerFont, setFooterFont] = useState<'serif' | 'sans' | 'display' | 'modern'>('modern');
  const [fullscreen, setFullscreen] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [calendarGone, setCalendarGone] = useState<CalendarDraftGone | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const activeCaption = editedCaptions[captionTab];

  const applyContent = (data: ContentDetail) => {
    setContent(data);
    setSlideIndex(0);
    const connected = data.connectedPlatforms || [];
    const connectedNames = connected.map((c) => c.platform);
    const preferred = (data.targetPlatforms || []).filter((p) => connectedNames.includes(p));
    setSelectedPlatforms(preferred.length ? preferred : connectedNames);
    setEditedCaptions(hydrateCaptionEditors(data));
    const nextSlots = (data.templateSlots || {}) as Record<string, unknown>;
    setSlots(nextSlots as Record<string, string>);
    const rawPrompt =
      data.imagePrompt || `Professional Instagram square graphic for: ${data.headline}`;
    // Exact-scrape posts used to store "Reference photo / metadata only" — that makes
    // Generate produce random art. Replace with a usable scene brief from the headline.
    const poisoned =
      /metadata description of the reused competitor|reference photo:/i.test(rawPrompt);
    setImagePrompt(
      poisoned
        ? `Photorealistic LinkedIn B2B editorial photograph for: ${data.headline}. ${String(data.body || '').slice(0, 220)} Single clear subject, natural light, premium agency finish, calm corner for a logo. No logos, watermarks, or readable text in the art.`
        : rawPrompt,
    );
    // Brand Studio / Placid posts keep the plate on — AI logo/overlays/style stay off
    setUseTemplate(Boolean(data.brandTemplateId));
    setHeaderText(data.headline || '');
    setFooterCta(data.callToAction || '');
    const savedPlacement = String(nextSlots.logoPlacement || '');
    if (LOGO_PLACEMENTS.some((p) => p.id === savedPlacement)) {
      setLogoPlacement(savedPlacement as (typeof LOGO_PLACEMENTS)[number]['id']);
    }
    const playId = String(nextSlots.playId || '');
    const savedOverlays = nextSlots.overlaysEnabled;
    if (savedOverlays === true || savedOverlays === 'true') {
      setOverlaysEnabled(true);
    } else if (savedOverlays === false || savedOverlays === 'false') {
      setOverlaysEnabled(false);
    } else {
      // Full AI feed tiles already include logo + type — keep overlays on for reframe.
      setOverlaysEnabled(playId === 'insight_report' || playId === 'b2c_feed' || playId === 'full_ai_feed');
    }
    if (playId === 'insight_report') setImageFormat('instagram_portrait');
    else if (playId === 'b2c_feed' || playId === 'full_ai_feed') setImageFormat('instagram_square');
    const savedStyle = String(nextSlots.visualStyleId || '');
    if (VISUAL_STYLES.some((s) => s.id === savedStyle)) {
      setVisualStyleId(savedStyle as (typeof VISUAL_STYLES)[number]['id']);
    } else if (playId === 'meme') {
      setVisualStyleId('meme_comic');
    } else if (playId === 'b2c_feed' || playId === 'full_ai_feed') {
      setVisualStyleId(playId === 'b2c_feed' ? 'cinematic_photo' : 'professional_photo');
    }
  };

  const updateActiveCaption = (patch: Partial<PlatformCaptionEdit>) => {
    setEditedCaptions((prev) => {
      const tab = captionTab;
      return {
        ...prev,
        [tab]: { ...prev[tab], ...patch },
      };
    });
  };

  const revisePayload = () => {
    const platformCaptions = buildPlatformCaptionsPayload(editedCaptions);
    const primary = platformCaptions.linkedin!;
    // Facebook/Twitter fall back to LinkedIn copy when no dedicated editor exists
    return {
      headline: primary.headline,
      body: primary.body,
      hashtags: primary.hashtags,
      callToAction: primary.callToAction,
      platformCaptions: {
        ...platformCaptions,
        facebook: platformCaptions.facebook || primary,
        twitter: platformCaptions.twitter || primary,
      },
      templateSlots: slots,
    };
  };

  const reload = async () => {
    const res = await api<{ data: ContentDetail }>(`/content/${id}`);
    setCalendarGone(null);
    applyContent(res.data);
    return res.data;
  };

  const regenerateCalendarDraft = async (entry: CalendarDraftGone) => {
    if (
      !window.confirm(
        `"${entry.title}" was aborted or deleted. Generate a new draft and send it to Approvals?`,
      )
    ) {
      return;
    }
    setRegenerating(true);
    setError('');
    try {
      const res = await api<{ data: { contentId: string } }>(
        `/content/calendar/plan/saved/${entry.planId}/entries/${entry.entryId}/generate`,
        { method: 'POST' },
      );
      notifySuccess('Generation started');
      router.replace(`/approvals/${res.data.contentId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not regenerate this calendar idea';
      setError(msg);
      notifyError(msg);
    } finally {
      setRegenerating(false);
    }
  };

  useEffect(() => {
    setCalendarGone(null);
    reload().catch((e) => {
      if (e instanceof ApiError && e.code === 'CALENDAR_DRAFT_GONE' && e.data) {
        setCalendarGone(e.data as CalendarDraftGone);
        setError('');
        return;
      }
      setError(e instanceof Error ? e.message : 'Failed to load');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!content || !chatAction) return;
    if (chatAction === 'post') {
      setOkMsg('Opened from Slack/Teams — confirm channels below, then Post to social media.');
      requestAnimationFrame(() => {
        document.getElementById('approval-publish')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    } else if (chatAction === 'reject') {
      setOkMsg('Opened from Slack/Teams — describe what to change, then Reject.');
      requestAnimationFrame(() => {
        document.getElementById('approval-reject')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const ta = document.querySelector<HTMLTextAreaElement>('#approval-reject textarea');
        ta?.focus();
      });
    }
  }, [content?.id, chatAction]);

  const carouselSlides = useMemo(() => {
    const slides = content?.carousel?.slides;
    if (!slides?.length) return [];
    return slides.filter((s) => Boolean(s.imageUrl));
  }, [content?.carousel]);

  const activeImageUrl = useMemo(() => {
    if (carouselSlides.length) {
      const idx = Math.min(Math.max(0, slideIndex), carouselSlides.length - 1);
      return carouselSlides[idx]?.imageUrl || content?.imageUrl || null;
    }
    return content?.imageUrl || null;
  }, [carouselSlides, slideIndex, content?.imageUrl]);

  const activeSlideHeadline = useMemo(() => {
    if (!carouselSlides.length) return null;
    const idx = Math.min(Math.max(0, slideIndex), carouselSlides.length - 1);
    return carouselSlides[idx]?.headline || null;
  }, [carouselSlides, slideIndex]);

  useEffect(() => {
    if (!carouselSlides.length) return;
    const idx = Math.min(Math.max(0, slideIndex), carouselSlides.length - 1);
    const slide = carouselSlides[idx];
    if (slide?.imagePrompt) setImagePrompt(slide.imagePrompt);
  }, [carouselSlides, slideIndex]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
      if (carouselSlides.length > 1 && e.key === 'ArrowLeft') {
        setSlideIndex((i) => (i - 1 + carouselSlides.length) % carouselSlides.length);
      }
      if (carouselSlides.length > 1 && e.key === 'ArrowRight') {
        setSlideIndex((i) => (i + 1) % carouselSlides.length);
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen, carouselSlides.length]);

  const handleDownload = useCallback(
    async (scale: 1 | 2 = 1) => {
      if (!activeImageUrl || !content) return;
      setDownloading(true);
      setError('');
      try {
        await downloadImageHighQuality(
          activeImageUrl,
          content.headline || `contentpilot-${content.id.slice(0, 8)}`,
          { scale },
        );
        setOkMsg(scale > 1 ? `Downloaded ${scale}× PNG` : 'Downloaded high-quality PNG');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Download failed');
      } finally {
        setDownloading(false);
      }
    },
    [activeImageUrl, content],
  );

  // Poll while still generating
  useEffect(() => {
    if (!content || content.status !== 'generating') return;
    const t = window.setInterval(() => {
      void reload().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(t);
  }, [content?.status, id]);

  useEffect(() => {
    if (!promptExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPromptExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [promptExpanded]);

  const textLayers = useMemo(
    () => (content?.templateLayers || []).filter((l) => l.type === 'text' && l.editable),
    [content],
  );
  const imageLayers = useMemo(
    () => (content?.templateLayers || []).filter((l) => l.type === 'image' && l.editable),
    [content],
  );
  const hasTemplate = Boolean(content?.brandTemplateId);
  /**
   * Strict: any post still bound to a Placid / in-house brand template must NOT expose
   * AI visual style, logo corner, or header/footer overlays. Those unlock only after
   * “Keep Brand Studio template” is off AND regenerate clears brandTemplateId.
   */
  const brandTemplateActive = hasTemplate;
  const isInsightPost = String(slots.playId || '') === 'insight_report';

  const applyOverlayFrame = async (mode: 'logo' | 'overlays' | 'all' = 'all') => {
    if (brandTemplateActive) {
      const msg =
        'Logo position and on-image text overlays are not available on Brand Studio / Placid templates. Edit template layers, or turn off “Keep Brand Studio template” and regenerate as full AI.';
      setError(msg);
      notifyError(msg);
      return;
    }
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{ data: ContentDetail }>(`/content/${id}/reframe-image`, {
        method: 'POST',
        body: {
          format: imageFormat,
          logoPlacement,
          headerText: headerText.trim() || null,
          footerCta: footerCta.trim() || null,
          overlaysEnabled: mode === 'logo' ? true : overlaysEnabled,
          headerFontSize,
          footerFontSize,
          headerFont,
          footerFont,
        },
      });
      const keptPlacement = logoPlacement;
      const keptOverlays = mode === 'logo' ? true : overlaysEnabled;
      const keptHeader = headerText;
      const keptFooter = footerCta;
      applyContent(res.data);
      setLogoPlacement(keptPlacement);
      setOverlaysEnabled(keptOverlays);
      setHeaderText(keptHeader);
      setFooterCta(keptFooter);
      const corner = keptPlacement.replace('-', ' ');
      const ok =
        mode === 'logo'
          ? `Logo moved to ${corner} on the same picture.`
          : keptOverlays
            ? isInsightPost
              ? 'Same picture kept — insight poster logo/type refreshed (no new AI image).'
              : 'On-image text overlays applied (no AI regenerate).'
            : 'Overlays removed — clean image, no logo or on-image text.';
      setOkMsg(ok);
      notifySuccess(
        mode === 'logo'
          ? `Logo → ${corner}`
          : keptOverlays
            ? 'Text overlays applied'
            : 'Overlays removed',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not update overlays';
      setError(msg);
      notifyError(msg);
    } finally {
      setBusy(false);
    }
  };

  const saveCaptionAndSlots = async () => {
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{ data: ContentDetail }>(`/content/${id}/revise`, {
        method: 'POST',
        body: {
          ...revisePayload(),
          rerender: true,
        },
      });
      applyContent(res.data);
      const msg = hasTemplate
        ? 'Captions + template text saved and image re-rendered. Review, then Post or Reject.'
        : 'Instagram + LinkedIn captions saved. Review, then Post or Reject.';
      setOkMsg(msg);
      notifySuccess(hasTemplate ? 'Captions & image saved' : 'Captions saved');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      notifyError(msg);
    } finally {
      setBusy(false);
    }
  };

  const uploadSlotImage = async (slot: string, file: File) => {
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('slot', slot);
      const res = await apiUpload<{ data: ContentDetail }>(
        `/content/${id}/upload-slot-image?slot=${encodeURIComponent(slot)}`,
        form,
      );
      applyContent(res.data);
      setOkMsg(`Uploaded image into “${slot}” and fitted it on the template.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const replaceCarouselSlideImage = async (file: File) => {
    if (!carouselSlides.length) return;
    const idx = Math.min(Math.max(0, slideIndex), carouselSlides.length - 1);
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiUpload<{ data: ContentDetail }>(
        `/content/${id}/carousel-slide/${idx}/replace-image`,
        form,
      );
      applyContent(res.data);
      setOkMsg(`Slide ${idx + 1} hero photo replaced — typography kept.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Replace failed');
    } finally {
      setBusy(false);
    }
  };

  const regenerateCarouselSlideArt = async () => {
    if (!carouselSlides.length) return;
    if (!imagePrompt.trim()) {
      setError('Enter a prompt for this slide’s hero photo area');
      return;
    }
    const idx = Math.min(Math.max(0, slideIndex), carouselSlides.length - 1);
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{ data: ContentDetail }>(
        `/content/${id}/carousel-slide/${idx}/regenerate-art`,
        {
          method: 'POST',
          body: { prompt: imagePrompt.trim(), exact: exactPrompt },
        },
      );
      applyContent(res.data);
      setOkMsg(`Slide ${idx + 1} hero art updated — layout & copy unchanged.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Slide art regenerate failed');
    } finally {
      setBusy(false);
    }
  };

  const regenerateImage = async () => {
    if (!imagePrompt.trim()) {
      setError('Enter an image prompt first');
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const keepingPlate = useTemplate && hasTemplate;
      const res = await api<{ data: ContentDetail }>(`/content/${id}/regenerate-image`, {
        method: 'POST',
        body: keepingPlate
          ? {
              prompt: imagePrompt.trim(),
              format: imageFormat,
              exact: exactPrompt,
              useBrandTemplate: true,
            }
          : {
              prompt: imagePrompt.trim(),
              format: imageFormat,
              exact: exactPrompt,
              useBrandTemplate: false,
              visualStyleId,
              logoPlacement,
              headerText: headerText.trim() || null,
              footerCta: footerCta.trim() || null,
              overlaysEnabled,
              headerFontSize,
              footerFontSize,
              headerFont,
              footerFont,
            },
        signal: ac.signal,
      });
      applyContent(res.data);
      setHeaderText(headerText);
      setFooterCta(footerCta);
      setLogoPlacement(logoPlacement);
      setVisualStyleId(visualStyleId);
      setOkMsg(
        useTemplate
          ? 'New AI art fitted into the template image area.'
          : exactPrompt
            ? 'Image generated from your AI prompt only (style + headline ignored).'
            : `${CREATIVE_MODE_LABELS.ai} (${VISUAL_STYLES.find((s) => s.id === visualStyleId)?.label || 'custom'}) — logo ${logoPlacement.replace('-', ' ')}.`,
      );
    } catch (e) {
      if (isAbortError(e)) setOkMsg('Image generation aborted.');
      else setError(e instanceof Error ? e.message : 'Image generation failed');
    } finally {
      setBusy(false);
    }
  };

  const submitDecision = async (action: 'approve' | 'reject_regenerate') => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSubmitting(action);
    setError('');
    setOkMsg('');
    try {
      if (action === 'approve' && selectedPlatforms.length === 0) {
        throw new Error('Select at least one connected channel to post.');
      }
      if (action === 'reject_regenerate' && !feedback.trim()) {
        throw new Error('Describe what to change (caption, hashtags, image, tone, etc.).');
      }

      if (action === 'approve') {
        const channelLabels = selectedPlatforms
          .map((p) => {
            const conn = content?.connectedPlatforms?.find((c) => c.platform === p);
            return conn ? `${p} (${conn.accountName})` : p;
          })
          .join(', ');
        const imgNote = carouselSlides.length > 1
          ? `${carouselSlides.length}-slide carousel + captions as shown`
          : 'the image and captions currently on this screen';
        if (
          !window.confirm(
            `Post ${imgNote} to:\n\n${channelLabels}\n\nOnly these channels will be used.`,
          )
        ) {
          setSubmitting(null);
          return;
        }

        // Save on-screen captions only — do NOT re-render the image (keep what the user sees).
        // Use "Save … & re-render" first if Brand Studio plate text must update on the art.
        await api(`/content/${id}/revise`, {
          method: 'POST',
          body: {
            ...revisePayload(),
            rerender: false,
          },
          signal: ac.signal,
        });
      }

      const res = await api<{ data: { nextAction: string } }>(`/content/${id}/approve`, {
        method: 'POST',
        body: {
          action,
          platforms: selectedPlatforms,
          ...(action === 'reject_regenerate' ? { feedback: feedback.trim() } : {}),
        },
        signal: ac.signal,
      });

      if (res.data.nextAction === 're_review') {
        await reload();
        setFeedback('');
        setOkMsg('Updated from your change request. Keep editing until you Post.');
      } else if (res.data.nextAction === 'manual_intervention') {
        setOkMsg('Max revisions reached — edit manually or contact an admin.');
        await reload();
      } else if (res.data.nextAction === 'publish') {
        notifySuccess(`Publishing to ${selectedPlatforms.join(', ')}…`);
        router.push('/approvals');
      } else {
        router.push('/approvals');
      }
    } catch (err) {
      if (isAbortError(err)) setOkMsg('Cancelled.');
      else setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setSubmitting(null);
    }
  };

  const abortPost = async (opts?: { confirm?: boolean }) => {
    if (opts?.confirm !== false) {
      if (!window.confirm('Abort this post? It leaves the queue as rejected (not permanently deleted).')) return;
    }
    abortRef.current?.abort();
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{
        data: { id: string; status: string; calendarEntry?: CalendarDraftGone | null };
      }>(`/content/${id}/abort`, { method: 'POST', body: {} });
      const calendarEntry = res.data.calendarEntry;
      if (calendarEntry) {
        const again = window.confirm(
          `"${calendarEntry.title}" was aborted. Generate a new draft from the content calendar?`,
        );
        if (again) {
          await regenerateCalendarDraft(calendarEntry);
          return;
        }
        router.push('/calendar');
        return;
      }
      router.push('/approvals');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Abort failed');
      setBusy(false);
    }
  };

  const cancelBusyWork = () => {
    abortRef.current?.abort();
    if (content?.status === 'generating') {
      void abortPost({ confirm: false });
      return;
    }
    setBusy(false);
    setSubmitting(null);
    setOkMsg('Cancelled.');
  };

  const deletePost = async () => {
    if (!window.confirm('Delete this post permanently? It will be removed from the database and cannot be undone.')) return;
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await api<{
        data: { id: string; deleted: true; calendarEntry?: CalendarDraftGone | null };
      }>(`/content/${id}`, { method: 'DELETE' });
      const calendarEntry = res.data.calendarEntry;
      if (calendarEntry) {
        const again = window.confirm(
          `"${calendarEntry.title}" was deleted. Generate a new draft from the content calendar?`,
        );
        if (again) {
          await regenerateCalendarDraft(calendarEntry);
          return;
        }
        router.push('/calendar');
        return;
      }
      router.push('/approvals');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setBusy(false);
    }
  };

  if (!content) {
    return (
      <AuthGuard>
        <div className="space-y-4">
          <BackButton href="/approvals" label="Approvals" />
          {calendarGone ? (
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Content calendar</p>
                  <p className="panel-title">This draft was deleted or aborted</p>
                </div>
              </div>
              <div className="panel-body space-y-4">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  <strong>{calendarGone.title}</strong> is still on your calendar for{' '}
                  {calendarGone.date}. Generate a new post from that idea — do not expect the
                  old Approvals link to work.
                </p>
                {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
                <div className="flex flex-wrap gap-2">
                  <ProcessingButton
                    icon={<RefreshCw size={14} />}
                    loading={regenerating}
                    loadingText="Generating…"
                    onClick={() => void regenerateCalendarDraft(calendarGone)}
                  >
                    Regenerate from calendar
                  </ProcessingButton>
                  <Link href="/calendar" className="btn btn-secondary">
                    Open calendar
                  </Link>
                </div>
              </div>
            </div>
          ) : error ? (
            <InlineNotice kind="error">{error}</InlineNotice>
          ) : (
            <LoadingState title="Loading approval" description="Preparing caption, image, and publish controls…" />
          )}
        </div>
      </AuthGuard>
    );
  }

  const reviewing = canReview(content.status);

  return (
    <AuthGuard>
      <div className="page-container !max-w-5xl animate-fade-in space-y-5">
        <div className="panel panel-accent">
          <div className="panel-body !py-4 sm:!py-5">
            <BackButton href="/approvals" label="Back to approvals" className="mb-4" />
            <div className="flex flex-wrap items-center gap-2">
              <span className="status-badge-engine capitalize">{content.engine}</span>
              <span
                className={
                  content.status === 'generating'
                    ? 'status-badge-generating capitalize'
                    : 'status-badge-pending capitalize'
                }
              >
                {content.status.replace(/_/g, ' ')}
              </span>
              {content.revisionCount > 0 && (
                <span className="status-badge-muted">Revision {content.revisionCount}</span>
              )}
              {content.templateName && (
                <span className="status-badge-muted">Template: {content.templateName}</span>
              )}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Review & publish</h1>
            <p className="mt-1 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
              Left: visual. Right: caption &amp; publish. Reject notes, abort, and delete live in the Revise section.
            </p>
          </div>
        </div>

        {content.status === 'generating' && (
          <InlineNotice kind="info">
            Still generating caption and image… this page refreshes automatically. Use Abort on the overlay to cancel.
          </InlineNotice>
        )}
        {chatAction === 'post' || chatAction === 'reject' ? (
          <InlineNotice kind="info">
            {chatAction === 'post'
              ? 'You opened this from Slack/Teams to post. Confirm channels, then use Post to social media.'
              : 'You opened this from Slack/Teams to reject. Add change notes, then Reject.'}
          </InlineNotice>
        ) : null}
        {(error || okMsg) && (
          <InlineNotice kind={error ? 'error' : 'success'}>{error || okMsg}</InlineNotice>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <section className="panel space-y-0">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Visual</p>
                <p className="panel-title">
                  {carouselSlides.length > 1
                    ? `Carousel · ${carouselSlides.length} slides`
                    : 'Post image'}
                </p>
              </div>
            </div>
            <div className="panel-body space-y-3">
            {activeImageUrl ? (
              <div className="group relative overflow-hidden bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={activeImageUrl}
                  src={activeImageUrl}
                  alt={activeSlideHeadline || 'Post visual'}
                  className="aspect-square w-full cursor-zoom-in object-cover"
                  onClick={() => setFullscreen(true)}
                />
                {carouselSlides.length > 1 ? (
                  <>
                    <button
                      type="button"
                      className="absolute left-1.5 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-sm hover:bg-black/85 sm:left-2"
                      onClick={() =>
                        setSlideIndex((i) => (i - 1 + carouselSlides.length) % carouselSlides.length)
                      }
                      aria-label="Previous slide"
                    >
                      <ChevronLeft size={22} />
                    </button>
                    <button
                      type="button"
                      className="absolute right-1.5 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-sm hover:bg-black/85 sm:right-2"
                      onClick={() => setSlideIndex((i) => (i + 1) % carouselSlides.length)}
                      aria-label="Next slide"
                    >
                      <ChevronRight size={22} />
                    </button>
                    <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-8">
                      <p className="text-center text-[11px] font-medium text-white/90">
                        Slide {Math.min(slideIndex, carouselSlides.length - 1) + 1} /{' '}
                        {carouselSlides.length}
                        {activeSlideHeadline ? ` · ${activeSlideHeadline}` : ''}
                      </p>
                      <div className="mt-1 flex justify-center gap-0.5">
                        {carouselSlides.map((s, i) => (
                          <button
                            key={`${s.imageUrl}-${i}`}
                            type="button"
                            className="flex h-11 w-11 items-center justify-center"
                            onClick={() => setSlideIndex(i)}
                            aria-label={`Go to slide ${i + 1}`}
                            aria-current={i === slideIndex ? 'true' : undefined}
                          >
                            <span
                              className={`block h-2 w-2 rounded-full ${
                                i === slideIndex ? 'bg-white scale-125' : 'bg-white/45'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
                <div className="pointer-events-none absolute inset-x-0 top-0 hidden justify-end gap-1.5 bg-gradient-to-b from-black/50 to-transparent p-2 opacity-100 transition sm:flex sm:opacity-0 sm:group-hover:opacity-100">
                  <button
                    type="button"
                    className="pointer-events-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-black/70 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/85"
                    onClick={() => setFullscreen(true)}
                  >
                    <Maximize2 size={14} /> Full screen
                  </button>
                  <button
                    type="button"
                    disabled={downloading}
                    className="pointer-events-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-black/70 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/85 disabled:opacity-50"
                    onClick={() => void handleDownload(1)}
                  >
                    <Download size={14} /> {downloading ? 'Saving…' : 'PNG'}
                  </button>
                </div>
                <div className="mt-0 flex flex-wrap gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 sm:hidden">
                  <button type="button" className="btn-secondary btn-sm flex-1" onClick={() => setFullscreen(true)}>
                    <Maximize2 size={13} className="mr-1 inline" /> Full screen
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm flex-1"
                    disabled={downloading}
                    onClick={() => void handleDownload(1)}
                  >
                    <Download size={13} className="mr-1 inline" /> Download
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
                No image yet — generate or upload below.
              </div>
            )}

            {carouselSlides.length > 1 && reviewing && (
              <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.25)] p-3 animate-fade-in">
                <p className="text-xs font-semibold">
                  Slide {Math.min(slideIndex, carouselSlides.length - 1) + 1} · hero photo only
                </p>
                <p className="helper-text">
                  Upload from your laptop or rewrite this photo with AI — typography stays. Does not
                  rebuild the whole carousel.
                </p>
                <div className="flex flex-wrap gap-2">
                  <label
                    className={`btn-secondary btn-sm inline-flex cursor-pointer items-center gap-1.5 ${
                      busy ? 'pointer-events-none opacity-60' : ''
                    }`}
                  >
                    <Upload size={14} />
                    Upload image
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void replaceCarouselSlideImage(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <ProcessingButton
                    variant="secondary"
                    className="btn-sm inline-flex items-center gap-1.5"
                    loading={busy && !submitting}
                    loadingText="Updating art…"
                    disabled={busy || !imagePrompt.trim()}
                    onClick={() => void regenerateCarouselSlideArt()}
                  >
                    <RefreshCw size={14} />
                    AI replace this photo
                  </ProcessingButton>
                </div>
              </div>
            )}

            {activeImageUrl && (
              <div className="hidden flex-wrap items-center gap-2 sm:flex">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setFullscreen(true)}>
                  <Maximize2 size={13} className="mr-1.5 inline" />
                  Full screen
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={downloading}
                  onClick={() => void handleDownload(1)}
                >
                  <Download size={13} className="mr-1.5 inline" />
                  Download PNG
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={downloading}
                  onClick={() => void handleDownload(2)}
                  title="2× pixel export for sharper print / retina"
                >
                  <Download size={13} className="mr-1.5 inline" />
                  2× HQ
                </button>
              </div>
            )}

            <div className="space-y-3 border-t border-[hsl(var(--border))] pt-4">
              <div>
                <p className="panel-kicker">Controls</p>
                <p className="panel-title flex items-center gap-2">
                  <ImageIcon size={14} /> Image generation
                </p>
              </div>

              {(content.brandTemplateId || content.templateName) && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 space-y-2">
                  <p className="text-[11px] text-amber-800 dark:text-amber-200">
                    This post uses Brand Studio / Placid template{' '}
                    <strong>{content.templateName || 'Brand Studio'}</strong>. Logo placement,
                    visual style, and on-image text overlays are controlled by the template — not
                    the AI overlay tools below. Turn the switch <strong>off</strong> and regenerate
                    only if you want a full AI photo (no plate).
                  </p>
                  <Toggle
                    checked={useTemplate}
                    onCheckedChange={setUseTemplate}
                    disabled={!reviewing}
                    label="Keep Brand Studio template"
                    description={
                      useTemplate
                        ? 'AI art (if regenerated) goes into the template picture zone only.'
                        : 'Off: generate a finished social image from the prompt — then logo / style / overlays apply.'
                    }
                  />
                </div>
              )}

              {useTemplate && hasTemplate && imageLayers.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    Upload a photo to fit into a template image area (hero / product zone).
                  </p>
                  {imageLayers.map((layer) => (
                    <label
                      key={layer.id}
                      className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-lg border border-dashed border-[hsl(var(--border))] px-3 py-3 text-xs hover:border-brand-500"
                    >
                      <span>
                        <Upload size={12} className="mr-1 inline" />
                        Upload into {layer.label}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        disabled={!reviewing || busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadSlotImage(layer.slot, file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}

              {brandTemplateActive ? (
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.25)] px-3.5 py-3">
                  <p className="text-sm font-semibold tracking-tight">Template controls layout</p>
                  <p className="mt-1 text-[11px] leading-snug text-[hsl(var(--muted-foreground))]">
                    Visual style, logo corner, and on-image header/footer overlays stay off while
                    this post is tied to a Placid or in-house brand template
                    {useTemplate
                      ? '. Edit template text layers or upload into picture zones above.'
                      : '. Turn off “Keep Brand Studio template”, then Generate — after the plate is removed, logo / style / overlays unlock for full AI posts.'}
                  </p>
                </div>
              ) : (
                <>
              <label className="block space-y-1">
                <span className="text-[11px] text-[hsl(var(--muted-foreground))]">Visual style</span>
                <select
                  className="input"
                  value={visualStyleId}
                  disabled={!reviewing || exactPrompt}
                  onChange={(e) => setVisualStyleId(e.target.value as typeof visualStyleId)}
                >
                  {VISUAL_STYLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} — {s.hint}
                    </option>
                  ))}
                </select>
                {exactPrompt && (
                  <p className="text-[10px] text-amber-700 dark:text-amber-300">
                    Exact prompt is on — style follows your prompt text (illustration, vector, photo, etc.).
                  </p>
                )}
              </label>

              <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-gradient-to-br from-[hsl(var(--card))] via-[hsl(var(--muted)/0.35)] to-[hsl(var(--card))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold tracking-tight">Logo position</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-[hsl(var(--muted-foreground))]">
                      Pick a corner, then tap Apply logo — moves the brand mark on the same picture.
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-brand-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-600">
                    {logoPlacement.replace('-', ' ')}
                  </span>
                </div>
                <div
                  className="grid grid-cols-2 gap-2"
                  role="radiogroup"
                  aria-label="Logo placement"
                >
                  {LOGO_PLACEMENTS.map((p) => {
                    const active = logoPlacement === p.id;
                    const [v, h] = p.id.split('-') as ['top' | 'bottom', 'left' | 'right'];
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={!reviewing}
                        onClick={() => setLogoPlacement(p.id)}
                        className={`group relative flex h-[72px] flex-col justify-between overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all duration-200 ${
                          active
                            ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/40'
                            : 'border-[hsl(var(--border))] bg-[hsl(var(--background)/0.65)] hover:border-brand-500/40 hover:bg-brand-500/5'
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <span className="relative h-8 w-full rounded-lg bg-[hsl(var(--muted)/0.55)]">
                          <span
                            className={`absolute h-3.5 w-3.5 rounded-md shadow-sm transition-transform ${
                              active ? 'bg-brand-600 scale-110' : 'bg-[hsl(var(--foreground)/0.45)] group-hover:bg-brand-500'
                            } ${v === 'top' ? 'top-1' : 'bottom-1'} ${h === 'left' ? 'left-1' : 'right-1'}`}
                          />
                        </span>
                        <span className={`text-[11px] font-medium ${active ? 'text-brand-700 dark:text-brand-300' : 'text-[hsl(var(--muted-foreground))]'}`}>
                          {p.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <ProcessingButton
                  variant="primary"
                  className="w-full !rounded-xl !font-semibold tracking-tight shadow-sm"
                  loading={busy && !submitting}
                  loadingText="Moving logo…"
                  disabled={!reviewing || !content.imageUrl}
                  onClick={() => void applyOverlayFrame('logo')}
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-sm bg-white/90" aria-hidden />
                    Apply logo position
                  </span>
                </ProcessingButton>
              </div>

              <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.22)] p-3.5">
                <Toggle
                  checked={overlaysEnabled}
                  onCheckedChange={setOverlaysEnabled}
                  disabled={!reviewing}
                  label="On-image text overlays"
                  description={
                    isInsightPost
                      ? overlaysEnabled
                        ? 'Designed insight poster stays. Same art, refreshed logo and type.'
                        : 'Off shows the clean background art only — same picture, no poster plate.'
                      : overlaysEnabled
                        ? 'Header + footer text are composited on the art. Tune size/font below.'
                        : 'Off = clean photo only — no logo watermark and no on-image text.'
                  }
                />

                {overlaysEnabled && (
                  <>
                    <label className="block space-y-1">
                      <span className="field-label">Header text</span>
                      <input
                        className="input text-sm"
                        value={headerText}
                        disabled={!reviewing}
                        onChange={(e) => setHeaderText(e.target.value)}
                        placeholder="Keep short — long lines wrap or truncate"
                      />
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="block space-y-1">
                        <span className="field-label">Header font</span>
                        <select
                          className="input"
                          value={headerFont}
                          disabled={!reviewing}
                          onChange={(e) => setHeaderFont(e.target.value as typeof headerFont)}
                        >
                          {OVERLAY_FONTS.map((f) => (
                            <option key={f.id} value={f.id}>{f.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-1">
                        <span className="field-label">Header size ({headerFontSize}px)</span>
                        <input
                          type="range"
                          min={24}
                          max={72}
                          value={headerFontSize}
                          disabled={!reviewing}
                          onChange={(e) => setHeaderFontSize(Number(e.target.value))}
                          className="w-full"
                        />
                      </label>
                    </div>
                    <label className="block space-y-1">
                      <span className="field-label">Footer CTA</span>
                      <input
                        className="input text-sm"
                        value={footerCta}
                        disabled={!reviewing}
                        onChange={(e) => setFooterCta(e.target.value)}
                        placeholder="e.g. Link in bio"
                      />
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="block space-y-1">
                        <span className="field-label">Footer font</span>
                        <select
                          className="input"
                          value={footerFont}
                          disabled={!reviewing}
                          onChange={(e) => setFooterFont(e.target.value as typeof footerFont)}
                        >
                          {OVERLAY_FONTS.map((f) => (
                            <option key={f.id} value={f.id}>{f.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-1">
                        <span className="field-label">Footer size ({footerFontSize}px)</span>
                        <input
                          type="range"
                          min={16}
                          max={48}
                          value={footerFontSize}
                          disabled={!reviewing}
                          onChange={(e) => setFooterFontSize(Number(e.target.value))}
                          className="w-full"
                        />
                      </label>
                    </div>
                  </>
                )}

                <ProcessingButton
                  variant="secondary"
                  className="w-full !rounded-xl !font-semibold tracking-tight"
                  loading={busy && !submitting}
                  loadingText="Applying overlays…"
                  disabled={!reviewing || !content.imageUrl}
                  onClick={() => void applyOverlayFrame('overlays')}
                >
                  Apply text overlays
                </ProcessingButton>
                <p className="text-[10px] leading-snug text-[hsl(var(--muted-foreground))]">
                  {isInsightPost
                    ? 'Keeps the same AI photo and the designed poster layout. Only logo / headline / CTA refresh. The picture only changes when you click Generate image again.'
                    : 'Applies instantly on the same AI art (no new generation). Turn overlays off to strip logo and text. Use Apply logo position above to move the mark.'}
                </p>
              </div>
                </>
              )}

              <div className="prompt-box">
                <div className="prompt-box-head">
                  <div className="min-w-0">
                    <p className="prompt-box-title">
                      <Sparkles size={13} className="text-brand-600 shrink-0" aria-hidden />
                      AI image prompt
                    </p>
                    <p className="prompt-box-hint">
                      Scene brief for Generate — open full view to edit comfortably.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="prompt-box-expand"
                    disabled={!reviewing && !imagePrompt}
                    onClick={() => setPromptExpanded(true)}
                    aria-haspopup="dialog"
                  >
                    <Maximize2 size={13} aria-hidden />
                    View full
                  </button>
                </div>
                <button
                  type="button"
                  className="prompt-box-preview"
                  disabled={!reviewing && !imagePrompt}
                  onClick={() => setPromptExpanded(true)}
                  aria-label="Open full AI prompt editor"
                >
                  <p className={`prompt-box-preview-text ${imagePrompt.trim() ? '' : 'is-empty'}`}>
                    {imagePrompt.trim() || 'No prompt yet — tap View full to write one.'}
                  </p>
                </button>
                <div className="prompt-box-meta">
                  <span>{imagePrompt.trim().length.toLocaleString()} chars</span>
                  <span className="text-[hsl(var(--muted-foreground)/0.7)]">Tap to expand</span>
                </div>
              </div>
              <select
                className="input"
                value={imageFormat}
                disabled={!reviewing}
                onChange={(e) => setImageFormat(e.target.value as typeof imageFormat)}
              >
                {IMAGE_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
              <Toggle
                checked={exactPrompt}
                onCheckedChange={setExactPrompt}
                disabled={!reviewing}
                label="Use only AI prompt"
                description="Ignores visual style + post headline. Image follows the AI image prompt box only."
              />
              <ProcessingButton
                loading={busy && !submitting}
                loadingText="Updating image…"
                icon={<RefreshCw size={14} />}
                disabled={!reviewing || !imagePrompt.trim()}
                onClick={() => void regenerateImage()}
                className="w-full"
              >
                {useTemplate && hasTemplate
                  ? 'AI image into template area'
                  : exactPrompt
                    ? 'Generate from AI prompt only'
                    : overlaysEnabled
                      ? 'Generate image with style + overlays'
                      : 'Generate image with style'}
              </ProcessingButton>
            </div>
            </div>
          </section>

          <div className="space-y-5">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Copy</p>
                  <p className="panel-title">Captions by platform</p>
                </div>
              </div>
              <div className="panel-body space-y-3">
              <div
                className="flex gap-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)] p-1"
                role="tablist"
                aria-label="Caption platform"
              >
                {([
                  { id: 'linkedin' as const, label: 'LinkedIn' },
                  { id: 'instagram' as const, label: 'Instagram' },
                ]).map((tab) => {
                  const active = captionTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`flex min-h-[44px] flex-1 items-center justify-center rounded-lg border px-3 py-2 text-xs font-medium transition md:min-h-[36px] md:rounded-md md:py-1.5 ${
                        active
                          ? 'border-brand-500/50 bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm'
                          : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
                      }`}
                      onClick={() => setCaptionTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {captionTab === 'instagram'
                  ? 'Punchier IG caption — used when posting to Instagram.'
                  : 'Professional LinkedIn caption — also stored as the primary fields.'}
              </p>
              <div key={captionTab} className="space-y-3">
              <label className="block space-y-1.5">
                <span className="field-label">Headline</span>
                <input
                  className="input"
                  value={activeCaption.headline}
                  disabled={!reviewing}
                  onChange={(e) => updateActiveCaption({ headline: e.target.value })}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="field-label">Body / caption</span>
                <textarea
                  className="input min-h-[140px]"
                  value={activeCaption.body}
                  disabled={!reviewing}
                  onChange={(e) => updateActiveCaption({ body: e.target.value })}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="field-label">Call to action</span>
                <input
                  className="input"
                  value={activeCaption.callToAction}
                  disabled={!reviewing}
                  onChange={(e) => updateActiveCaption({ callToAction: e.target.value })}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="field-label">Hashtags (comma-separated, no # needed)</span>
                <input
                  className="input"
                  value={activeCaption.hashtags}
                  disabled={!reviewing}
                  onChange={(e) => updateActiveCaption({ hashtags: e.target.value })}
                />
              </label>
              </div>
              {String(slots.playId || '') === 'meme' && (slots.memeFormatLabel || slots.trendHook) && (
                <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)] px-3 py-2 text-[12px] text-[hsl(var(--foreground))]">
                  <p>
                    Meme format:{' '}
                    <span className="font-medium">{slots.memeFormatLabel || 'Trending archetype'}</span>
                  </p>
                  {slots.trendHook ? (
                    <p className="mt-1 text-[hsl(var(--muted-foreground))]">Trend hook: {slots.trendHook}</p>
                  ) : null}
                  {slots.markets ? (
                    <p className="mt-1 text-[hsl(var(--muted-foreground))]">Markets: {slots.markets}</p>
                  ) : null}
                  {slots.whyThisFormat ? (
                    <p className="mt-1 text-[hsl(var(--muted-foreground))]">Why: {slots.whyThisFormat}</p>
                  ) : null}
                </div>
              )}
              {content.sourceReference && (
                <p className="break-all text-[11px] text-[hsl(var(--muted-foreground))]">
                  Source: {content.sourceReference.split('\n')[0]}
                </p>
              )}
              </div>
            </section>

            {hasTemplate && textLayers.length > 0 && (
              <section className="panel panel-accent">
                <div className="panel-header">
                  <div>
                    <p className="panel-kicker">Template</p>
                    <p className="panel-title">Dynamic on-image text</p>
                  </div>
                </div>
                <div className="panel-body space-y-3">
                <p className="helper-text">
                  These fill on-image zones exactly as typed. Saving re-renders the plate with your
                  text — it will not invent new copy or a new background photo.
                </p>
                {textLayers.map((layer) => (
                  <label key={layer.id} className="block space-y-1.5">
                    <span className="field-label">
                      {layer.label}
                      {layer.fillHint ? ` — ${layer.fillHint}` : ''}
                    </span>
                    <textarea
                      className="input min-h-[56px] text-sm"
                      value={slots[layer.slot] || ''}
                      disabled={!reviewing}
                      onChange={(e) => setSlots({ ...slots, [layer.slot]: e.target.value })}
                    />
                  </label>
                ))}
                </div>
              </section>
            )}

            <ProcessingButton
              className="w-full"
              loading={busy && !submitting}
              loadingText="Saving…"
              icon={<Save size={14} />}
              disabled={!reviewing}
              onClick={() => void saveCaptionAndSlots()}
              variant="secondary"
            >
              Save Instagram + LinkedIn captions{hasTemplate ? ' & re-render image' : ''}
            </ProcessingButton>

            <section id="approval-publish" className="panel panel-success">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Publish</p>
                  <p className="panel-title">Post to connected channels</p>
                </div>
              </div>
              <div className="panel-body space-y-3">
                <p className="text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                  Posts the <strong>image on the left</strong> and the{' '}
                  <strong>Instagram / LinkedIn captions</strong> in the editors (each channel gets its
                  own caption). Only checked channels below are used.
                  {hasTemplate ? (
                    <>
                      {' '}
                      If Brand Studio plate text must match the caption, click{' '}
                      <strong>Save … &amp; re-render image</strong> first.
                    </>
                  ) : null}
                </p>
                {(content.connectedPlatforms || []).length === 0 ? (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    No active channels. Add them in{' '}
                    <Link href="/settings" className="underline">Settings → Publish</Link>.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {content.connectedPlatforms.map((c) => (
                      <label
                        key={c.id}
                        className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                          selectedPlatforms.includes(c.platform)
                            ? 'border-emerald-500/40 bg-emerald-500/10'
                            : 'border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="accent-emerald-600"
                          checked={selectedPlatforms.includes(c.platform)}
                          disabled={!reviewing}
                          onChange={(e) => {
                            setSelectedPlatforms((prev) =>
                              e.target.checked
                                ? [...new Set([...prev, c.platform])]
                                : prev.filter((x) => x !== c.platform),
                            );
                          }}
                        />
                        <span className="inline-flex min-w-0 flex-1 items-center gap-2">
                          <PlatformBadge platform={c.platform} size="sm" />
                          <span className="truncate text-[hsl(var(--muted-foreground))]">
                            {c.accountName}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {selectedPlatforms.length > 0 && (
                  <p className="text-[11px] font-medium text-emerald-800 dark:text-emerald-200">
                    Will post to: {selectedPlatforms.join(', ')}
                  </p>
                )}
              </div>
            </section>

            <section id="approval-reject" className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Revise</p>
                  <p className="panel-title flex items-center gap-2">
                    <XCircle size={14} /> Reject — what should change?
                  </p>
                </div>
              </div>
              <div className="panel-body space-y-3">
                <textarea
                  className="input min-h-[100px] w-full"
                  value={feedback}
                  disabled={!reviewing}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="e.g. Make headline shorter, add offer hashtag, warmer tone, replace hero image…"
                />
                <div className="flex flex-col gap-2 border-t border-[hsl(var(--border))] pt-3 sm:flex-row sm:items-stretch">
                  <ProcessingButton
                    variant="danger-outline"
                    icon={<Ban size={14} />}
                    loading={busy && !submitting}
                    loadingText="Aborting…"
                    disabled={!reviewing || submitting !== null}
                    onClick={() => void abortPost()}
                    className="w-full min-h-[44px] sm:flex-1"
                  >
                    Abort post
                  </ProcessingButton>
                  <ProcessingButton
                    variant="danger"
                    icon={<Trash2 size={14} />}
                    loading={busy && !submitting}
                    loadingText="Deleting…"
                    disabled={submitting !== null}
                    onClick={() => void deletePost()}
                    className="w-full min-h-[44px] sm:flex-1"
                  >
                    Delete post
                  </ProcessingButton>
                </div>
                <p className="helper-text !mt-0">
                  <strong>Abort</strong> cancels review (status → rejected). <strong>Delete</strong> permanently removes it from the database.
                </p>
              </div>
            </section>
          </div>
        </div>

        {(content.approvals?.length ?? 0) > 0 && (
          <div className="panel">
            <div className="panel-header">
              <p className="panel-title">History</p>
            </div>
            <div className="panel-body space-y-2">
              {(content.approvals ?? []).map((a, i) => (
                <div key={i} className="border-b border-[hsl(var(--border))] pb-2 text-sm last:border-0">
                  <span className="font-medium capitalize">{a.action.replace(/_/g, ' ')}</span>
                  <span className="text-[hsl(var(--muted-foreground))]"> by {a.reviewer?.name ?? 'Unknown'}</span>
                  {a.feedback && <p className="mt-1 text-[hsl(var(--muted-foreground))]">{a.feedback}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {reviewing && (
          <div className="mobile-action-bar !flex-col sm:!flex-row">
            <ProcessingButton
              onClick={() => void submitDecision('approve')}
              loading={submitting === 'approve'}
              loadingText="Posting…"
              disabled={selectedPlatforms.length === 0 || submitting !== null || busy}
              variant="success"
              className="w-full flex-1"
              icon={<CheckCircle size={18} />}
            >
              Post to selected channels
            </ProcessingButton>
            <ProcessingButton
              onClick={() => void submitDecision('reject_regenerate')}
              loading={submitting === 'reject_regenerate'}
              loadingText="Applying changes…"
              variant="secondary"
              disabled={submitting !== null || busy}
              className="w-full flex-1"
              icon={<RefreshCw size={18} />}
            >
              Reject & change with prompt
            </ProcessingButton>
          </div>
        )}
      </div>

      {promptExpanded && (
        <div
          className="prompt-popup-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPromptExpanded(false);
          }}
        >
          <div
            className="prompt-popup-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-popup-title"
          >
            <div className="prompt-popup-head">
              <div className="min-w-0">
                <p id="prompt-popup-title" className="prompt-popup-title">
                  <Sparkles size={15} className="text-brand-600 shrink-0" aria-hidden />
                  AI image prompt
                </p>
                <p className="prompt-popup-sub">
                  Edit the full scene brief. Changes stay when you close.
                </p>
              </div>
              <button
                type="button"
                className="prompt-popup-close"
                onClick={() => setPromptExpanded(false)}
                aria-label="Close prompt editor"
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              className="prompt-popup-textarea"
              value={imagePrompt}
              disabled={!reviewing}
              autoFocus
              spellCheck
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder="Describe the scene, lighting, subject, mood… No logos or readable text in the art."
            />
            <div className="prompt-popup-foot">
              <span className="tabular-nums text-[11px] text-[hsl(var(--muted-foreground))]">
                {imagePrompt.trim().length.toLocaleString()} characters
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-ghost min-h-[44px] md:!min-h-[40px] !rounded-xl !px-3 text-xs"
                  onClick={() => setPromptExpanded(false)}
                >
                  <Minimize2 size={13} aria-hidden />
                  Collapse
                </button>
                <button
                  type="button"
                  className="btn-primary min-h-[44px] md:!min-h-[40px] !rounded-xl !px-4 text-xs font-semibold"
                  onClick={() => setPromptExpanded(false)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {fullscreen && activeImageUrl && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/95"
          role="dialog"
          aria-modal="true"
          aria-label="Full screen image"
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5 sm:px-5">
            <p className="min-w-0 flex-1 truncate text-sm text-white/90">
              {activeSlideHeadline || content.headline || 'Post image'}
              {carouselSlides.length > 1
                ? ` · ${Math.min(slideIndex, carouselSlides.length - 1) + 1}/${carouselSlides.length}`
                : ''}
            </p>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {carouselSlides.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/20"
                    onClick={() =>
                      setSlideIndex((i) => (i - 1 + carouselSlides.length) % carouselSlides.length)
                    }
                  >
                    <ChevronLeft size={16} /> Prev
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/20"
                    onClick={() => setSlideIndex((i) => (i + 1) % carouselSlides.length)}
                  >
                    Next <ChevronRight size={16} />
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-50"
                disabled={downloading}
                onClick={() => void handleDownload(1)}
              >
                <Download size={14} />
                PNG
              </button>
              <button
                type="button"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-50"
                disabled={downloading}
                onClick={() => void handleDownload(2)}
              >
                <Download size={14} />
                2× HQ
              </button>
              <button
                type="button"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/20"
                onClick={() => setFullscreen(false)}
                aria-label="Close full screen"
              >
                <X size={16} />
                <span className="hidden sm:inline">Close</span>
              </button>
            </div>
          </div>
          <button
            type="button"
            className="flex min-h-0 flex-1 cursor-zoom-out items-center justify-center p-3 sm:p-6"
            onClick={() => setFullscreen(false)}
            aria-label="Close full screen"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeImageUrl}
              alt="Post visual full screen"
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </button>
        </div>
      )}

      <ProcessOverlay
        open={Boolean(busy || submitting || content?.status === 'generating')}
        title={
          content?.status === 'generating'
            ? 'Generating caption & image'
            : submitting === 'approve'
              ? 'Publishing to channels'
              : submitting === 'reject_regenerate'
                ? 'Regenerating from your prompt'
                : busy
                  ? 'Generating image'
                  : 'Updating post'
        }
        description={
          content?.status === 'generating'
            ? 'Worker is still building this post. Abort cancels it in Approvals.'
            : 'You can abort to stop waiting on this request.'
        }
        onCancel={cancelBusyWork}
        cancelLabel="Abort"
      />
    </AuthGuard>
  );
}

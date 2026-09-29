'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AuthGuard } from '@/components/auth-guard';
import { api, apiUpload } from '@/lib/api';
import {
  Brain, Check, FileText, Image, ImagePlus, LayoutGrid, LayoutTemplate, Lightbulb, MessageSquare, Plus, Send, Sparkles, Square, Trash2, X,
} from 'lucide-react';
import {
  FALLBACK_KIT,
  PosterTemplatePicker,
  PosterTemplateStrip,
  TemplateLockNote,
  type BrandKitPreview,
  type PosterTemplate,
} from '@/components/poster-template-picker';
import { InlineNotice, LoadingState, ProcessOverlay, ProcessingButton, ProgressBar, Toggle } from '@/components/ui';
import { isAbortError } from '@/lib/abort';

type BrandTemplate = {
  id: string;
  name: string;
  provider: string;
  backgroundUrl?: string | null;
  previewUrl?: string | null;
  canvas?: {
    postType?: string;
    designSource?: 'placid' | 'inhouse';
  } | null;
  isActive: boolean;
};

type BrandProfile = {
  companyName?: string | null;
  logoUrl?: string | null;
  imageStyle?: string | null;
  brandType?: string | null;
};

type ImageFormat = 'instagram_square' | 'instagram_portrait' | 'linkedin' | 'story';
type OutputMode = 'auto' | 'text' | 'image';
type AttachmentRole = 'edit' | 'style' | 'asset';

const IMAGE_FORMATS: Array<{ id: ImageFormat; label: string }> = [
  { id: 'instagram_square', label: 'IG square' },
  { id: 'instagram_portrait', label: 'IG portrait' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'story', label: 'Story' },
];

type PlaySuggestion = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  why: string;
  format: string;
  channels: string[];
  risk: 'low' | 'medium' | 'high';
  preferredVisualMode: 'new_poster' | 'existing_template' | 'either';
  postType: string;
  starterPrompt: string;
  caveat?: string;
  needsDate?: boolean;
  requiresBrief?: boolean;
  briefPrompt?: string;
};

/** How the visual gets made. Maps onto the API's visualMode + posterTemplateId. */
type DesignSource = 'template' | 'brand_template' | 'ai';

type ChatMsg = {
  role: 'user' | 'assistant';
  text: string;
  contentId?: string;
  playId?: string | null;
  suggestions?: PlaySuggestion[];
  preview?: {
    headline: string;
    body: string;
    hashtags: string[];
    imageUrl?: string | null;
    captions?: {
      instagram?: { headline: string; body: string; hashtags: string[]; callToAction?: string | null };
      linkedin?: { headline: string; body: string; hashtags: string[]; callToAction?: string | null };
    };
  };
  approvalStatus?: 'assistant_draft' | 'pending_approval' | null;
};

type AssistantConversation = {
  id: string;
  title: string;
  activeContentId?: string | null;
  updatedAt: string;
};

type AssistantMemory = {
  id: string;
  key: string;
  value: string;
  category: string;
};

function mediaUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  const [pathPart, query] = url.split('?');
  const encoded = pathPart
    .split('/')
    .map((seg) => {
      if (!seg) return '';
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch {
        return encodeURIComponent(seg);
      }
    })
    .join('/');
  return query ? `${encoded}?${query}` : encoded;
}

function riskTone(risk: PlaySuggestion['risk']) {
  if (risk === 'high') return 'text-red-600 bg-red-500/10';
  if (risk === 'medium') return 'text-amber-700 bg-amber-500/10';
  return 'text-emerald-700 bg-emerald-500/10';
}

function attachmentRoleLabel(role: AttachmentRole) {
  if (role === 'edit') return 'Edit this image';
  if (role === 'asset') return 'Brand/product asset';
  return 'Style reference';
}

function ReferenceAttachmentPreview({
  url,
  fileName,
  role,
  onRoleChange,
  onRemove,
  onReplace,
  uploading,
  compact,
}: {
  url: string;
  fileName?: string | null;
  role: AttachmentRole;
  onRoleChange: (role: AttachmentRole) => void;
  onRemove: () => void;
  onReplace?: () => void;
  uploading?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/[0.08] ${
        compact ? 'p-2' : 'p-2.5'
      }`}
      role="status"
      aria-live="polite"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mediaUrl(url)}
        alt="Uploaded reference"
        className={`${compact ? 'h-12 w-12' : 'h-16 w-16'} shrink-0 rounded-lg object-cover border border-[hsl(var(--border))] bg-[hsl(var(--background))]`}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
          {uploading ? 'Uploading…' : 'Image uploaded'}
        </p>
        <p className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">
          {fileName || 'Reference ready for this chat'}
        </p>
        <select
          className="input !min-h-[32px] !w-full max-w-[220px] text-xs"
          value={role}
          onChange={(e) => onRoleChange(e.target.value as AttachmentRole)}
          aria-label="Image attachment role"
          disabled={uploading}
        >
          <option value="edit">Edit this image</option>
          <option value="style">Style reference</option>
          <option value="asset">Brand/product asset</option>
        </select>
        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
          Using as: {attachmentRoleLabel(role)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        {onReplace && (
          <button
            type="button"
            className="btn-ghost !min-h-[32px] !px-2 text-[11px]"
            onClick={onReplace}
            disabled={uploading}
          >
            Replace
          </button>
        )}
        <button
          type="button"
          className="btn-ghost !min-h-[32px] !min-w-[32px] !p-1.5"
          onClick={onRemove}
          disabled={uploading}
          aria-label="Remove uploaded image"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export default function AiAssistantPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<LoadingState title="Opening AI Assistant" description="Loading your templates…" />}>
        <AiAssistantInner />
      </Suspense>
    </AuthGuard>
  );
}

function AiAssistantInner() {
  const searchParams = useSearchParams();
  const templateFromUrl = searchParams.get('template') || '';
  const [templates, setTemplates] = useState<BrandTemplate[]>([]);
  const [brand, setBrand] = useState<BrandProfile | null>(null);
  const [plays, setPlays] = useState<PlaySuggestion[]>([]);
  const [brandType, setBrandType] = useState<'b2b' | 'b2c'>('b2b');
  const [selectedId, setSelectedId] = useState('');
  const [visualMode, setVisualMode] = useState<'existing_template' | 'new_poster' | null>(null);
  const [designSource, setDesignSource] = useState<DesignSource>('template');
  const [posterTemplates, setPosterTemplates] = useState<PosterTemplate[]>([]);
  const [brandKit, setBrandKit] = useState<BrandKitPreview>(FALLBACK_KIT);
  const [posterTemplateId, setPosterTemplateId] = useState<string | null>(null);
  const [includeLogo, setIncludeLogo] = useState(true);
  const [imageFormat, setImageFormat] = useState<ImageFormat>('instagram_square');
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [referenceFileName, setReferenceFileName] = useState<string | null>(null);
  const [attachmentRole, setAttachmentRole] = useState<AttachmentRole>('style');
  const [outputMode, setOutputMode] = useState<OutputMode>('auto');
  const [uploadingRef, setUploadingRef] = useState(false);
  const [message, setMessage] = useState('');
  const [chatLog, setChatLog] = useState<ChatMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [activeContentId, setActiveContentId] = useState<string | null>(null);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memories, setMemories] = useState<AssistantMemory[]>([]);
  const [showMemory, setShowMemory] = useState(false);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [llmWarning, setLlmWarning] = useState('');
  const [activePlayId, setActivePlayId] = useState<string | null>(null);
  const [briefPlay, setBriefPlay] = useState<PlaySuggestion | null>(null);
  const [briefText, setBriefText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) || null,
    [templates, selectedId],
  );

  /** The three designed layouts for whichever format the user is briefing. */
  const playTemplates = useMemo(() => {
    const forPlay = briefPlay?.id || activePlayId;
    if (!forPlay) return [];
    return posterTemplates.filter((t) => t.playId === forPlay);
  }, [posterTemplates, briefPlay, activePlayId]);

  const chosenTemplate = useMemo(
    () => playTemplates.find((t) => t.id === posterTemplateId) || null,
    [playTemplates, posterTemplateId],
  );

  const readyToGenerate =
    designSource === 'brand_template'
      ? Boolean(selectedId)
      : designSource === 'template'
        ? Boolean(chosenTemplate)
        : true;

  const canChat = Boolean(message.trim()) && !busy;

  const workflowStep = busy || chatLog.some((m) => m.preview)
    ? 3
    : !activePlayId
      ? 1
      : designSource === 'template' && !posterTemplateId
        ? 2
        : designSource === 'brand_template' && !selectedId
          ? 2
          : 3;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tplRes, brandRes, playRes, posterRes] = await Promise.all([
          api<{ data: BrandTemplate[] }>('/brand/templates'),
          api<{ data: BrandProfile }>('/settings/brand').catch(() => ({ data: {} as BrandProfile })),
          api<{ data: { brandType: string; plays: PlaySuggestion[] } }>('/brand/playbook').catch(() => ({
            data: { brandType: 'b2b', plays: [] as PlaySuggestion[] },
          })),
          api<{ data: { templates: PosterTemplate[]; brandKit: BrandKitPreview } }>(
            '/brand/poster-templates',
          ).catch(() => ({ data: { templates: [] as PosterTemplate[], brandKit: FALLBACK_KIT } })),
          api<{ data: Record<string, unknown> }>('/settings/providers')
            .then((res) => {
              if (cancelled) return;
              const d = res.data;
              if (d.llmProvider === 'claude' && !d.claudeApiKeySet) {
                setLlmWarning('Text model selected but no API key is saved. Add it in Settings → Integrations.');
              } else if (d.llmProvider === 'claude' && !d.claudeWorkspaceIdSet) {
                setLlmWarning('Text model needs a workspace ID. Add it under Settings → Integrations.');
              } else if (d.llmProvider === 'openai' && !d.openaiApiKeySet) {
                setLlmWarning('Text model selected but no API key is saved. Add it in Settings → Integrations.');
              } else {
                setLlmWarning('');
              }
            })
            .catch(() => undefined),
        ]);
        if (cancelled) return;
        setTemplates(tplRes.data || []);
        setBrand(brandRes.data || null);
        if (!brandRes.data?.logoUrl) setIncludeLogo(false);
        setPlays(playRes.data?.plays || []);
        setBrandType(playRes.data?.brandType === 'b2c' ? 'b2c' : 'b2b');
        setPosterTemplates(posterRes.data?.templates || []);
        if (posterRes.data?.brandKit) setBrandKit(posterRes.data.brandKit);
        const prefer =
          templateFromUrl && tplRes.data?.find((t) => t.id === templateFromUrl)?.id;
        if (prefer) {
          setSelectedId(prefer);
          setVisualMode('existing_template');
          setDesignSource('brand_template');
        } else {
          setVisualMode('new_poster');
          setDesignSource((posterRes.data?.templates || []).length ? 'template' : 'ai');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load templates');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateFromUrl]);

  const openConversation = async (id: string) => {
    const res = await api<{
      data: AssistantConversation & {
        messages: Array<{
          role: string;
          content: string;
          contentId?: string | null;
          metadata?: { preview?: ChatMsg['preview']; approvalStatus?: ChatMsg['approvalStatus'] };
        }>;
      };
    }>(`/brand/chat/conversations/${id}`);
    setConversationId(res.data.id);
    setActiveContentId(res.data.activeContentId || null);
    setChatLog(
      (res.data.messages || []).map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        text: m.content,
        contentId: m.contentId || undefined,
        preview: m.metadata?.preview || undefined,
        approvalStatus: m.metadata?.approvalStatus || (m.contentId ? 'assistant_draft' : null),
      })),
    );
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [conversationRes, memoryRes] = await Promise.all([
          api<{ data: AssistantConversation[] }>('/brand/chat/conversations'),
          api<{ data: { enabled: boolean; memories: AssistantMemory[] } }>('/brand/chat/memory'),
        ]);
        if (cancelled) return;
        setConversations(conversationRes.data || []);
        setMemoryEnabled(memoryRes.data.enabled);
        setMemories(memoryRes.data.memories || []);
        if (conversationRes.data?.[0]?.id) {
          await openConversation(conversationRes.data[0].id);
        }
      } catch {
        // A new tenant may have no conversations/settings yet.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startNewConversation = async () => {
    const res = await api<{ data: AssistantConversation }>('/brand/chat/conversations', {
      method: 'POST',
      body: {},
    });
    setConversations((items) => [res.data, ...items]);
    setConversationId(res.data.id);
    setActiveContentId(null);
    setChatLog([]);
    setReferenceUrl(null);
    setReferenceFileName(null);
    setSubmittedIds(new Set());
  };

  const toggleMemory = async (enabled: boolean) => {
    setMemoryEnabled(enabled);
    try {
      await api('/brand/chat/memory', { method: 'PUT', body: { enabled } });
    } catch (e) {
      setMemoryEnabled(!enabled);
      setError(e instanceof Error ? e.message : 'Could not update memory');
    }
  };

  const clearMemories = async () => {
    await api('/brand/chat/memory', { method: 'DELETE' });
    setMemories([]);
  };

  const deleteMemory = async (id: string) => {
    await api(`/brand/chat/memory/${id}`, { method: 'DELETE' });
    setMemories((items) => items.filter((m) => m.id !== id));
  };

  const sendToApprovals = async (contentId: string) => {
    setApprovalBusyId(contentId);
    setError('');
    try {
      await api(`/brand/chat/${contentId}/send-to-approvals`, { method: 'POST', body: {} });
      setSubmittedIds((ids) => new Set(ids).add(contentId));
      setChatLog((items) =>
        items.map((item) =>
          item.contentId === contentId ? { ...item, approvalStatus: 'pending_approval' } : item,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send draft to Approvals');
    } finally {
      setApprovalBusyId(null);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog, busy]);

  const clearReference = () => {
    setReferenceUrl(null);
    setReferenceFileName(null);
  };

  const uploadReference = async (file: File) => {
    setUploadingRef(true);
    setError('');
    setReferenceFileName(file.name);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiUpload<{ data: { publicUrl: string } }>('/brand/chat/upload-reference', fd);
      setReferenceUrl(res.data.publicUrl);
      setReferenceFileName(file.name);
    } catch (e) {
      setReferenceUrl(null);
      setReferenceFileName(null);
      setError(e instanceof Error ? e.message : 'Reference upload failed');
    } finally {
      setUploadingRef(false);
    }
  };

  const sendChat = async (opts?: {
    text?: string;
    preferredPlay?: string | null;
    forceVisualMode?: 'existing_template' | 'new_poster' | null;
    /** Explicit template for this send — state may not have flushed yet. */
    posterTemplate?: string | null;
  }) => {
    const userMsg = (opts?.text ?? message).trim();
    if (!userMsg || busy) return;

    const templateForSend =
      opts?.posterTemplate !== undefined
        ? opts.posterTemplate
        : designSource === 'template'
          ? posterTemplateId
          : null;

    let mode = opts?.forceVisualMode !== undefined ? opts.forceVisualMode : visualMode;
    // A ContentPilot template is always a new poster, never a Brand Studio plate.
    if (templateForSend) mode = 'new_poster';
    const preferred =
      opts?.preferredPlay ||
      (briefPlay && userMsg.length >= 12 ? briefPlay.id : null) ||
      null;
    const play = plays.find((p) => p.id === preferred) || null;
    if (preferred && play) {
      if (designSource === 'brand_template' && selectedId) {
        mode = 'existing_template';
        setVisualMode('existing_template');
      } else if (
        !templateForSend &&
        (play.preferredVisualMode === 'new_poster' || play.preferredVisualMode === 'either')
      ) {
        if (mode !== 'existing_template' || !selectedId) {
          mode = 'new_poster';
          setVisualMode('new_poster');
        }
      }
      setActivePlayId(play.id);
      if (briefPlay?.id === play.id) {
        setBriefPlay(null);
        setBriefText('');
      }
    }

    const looksLikeIdeas = /\b(suggest|ideas|what should we post|brainstorm|variations|formats)\b/i.test(
      userMsg,
    );
    const explicitlyRequestsImage =
      /\b(image|poster|visual|graphic|creative|photo|illustration|edit (this|the) image|change (this|the) image)\b/i.test(
        userMsg,
      );
    const wantsImage = outputMode === 'image' || explicitlyRequestsImage || Boolean(preferred);
    if (wantsImage && !looksLikeIdeas && (preferred || activePlayId)) {
      if (designSource === 'template' && !templateForSend) {
        setError(
          'Pick one of the three ContentPilot layouts for this format, or switch to your brand template / Let AI design it.',
        );
        return;
      }
      if (designSource === 'brand_template' && !selectedId) {
        setError('Select a Brand Studio template, or switch design source.');
        return;
      }
    }

    if (wantsImage && mode === 'existing_template' && !selectedId && !preferred) {
      setError('Select a Brand Studio template, or switch to Let AI design it.');
      return;
    }

    setMessage('');
    const history = chatLog.map((m) => ({ role: m.role, content: m.text }));
    setChatLog((l) => [...l, { role: 'user', text: userMsg }]);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError('');
    try {
      const res = await api<{
        data: {
          assistantMessage: string;
          action: string;
          conversationId: string;
          conversationTitle: string;
          contentId?: string;
          approvalStatus?: 'assistant_draft' | null;
          memoryEnabled?: boolean;
          playId?: string | null;
          suggestions?: PlaySuggestion[];
          preview?: ChatMsg['preview'];
        };
      }>('/brand/chat', {
        method: 'POST',
        body: {
          conversationId,
          activeContentId,
          brandTemplateId: mode === 'existing_template' ? selectedId : null,
          visualMode: mode,
          message: userMsg,
          history,
          includeLogo: mode === 'new_poster' ? includeLogo : undefined,
          referenceImageUrl: mode === 'new_poster' ? referenceUrl : undefined,
          attachmentRole: referenceUrl ? attachmentRole : undefined,
          outputMode,
          imageFormat: mode === 'new_poster' ? imageFormat : undefined,
          preferredPlay: preferred || undefined,
          posterTemplateId: templateForSend || undefined,
        },
        signal: ac.signal,
      });
      setConversationId(res.data.conversationId);
      if (res.data.contentId) setActiveContentId(res.data.contentId);
      if (typeof res.data.memoryEnabled === 'boolean') setMemoryEnabled(res.data.memoryEnabled);
      if (res.data.playId) setActivePlayId(res.data.playId);
      // If assistant asked for details again, reopen brief panel
      if (
        res.data.action === 'reply' &&
        res.data.playId &&
        !res.data.preview
      ) {
        const askPlay = plays.find((p) => p.id === res.data.playId);
        if (askPlay?.requiresBrief) {
          setBriefPlay(askPlay);
        }
      }
      setChatLog((l) => [
        ...l,
        {
          role: 'assistant',
          text: res.data.assistantMessage,
          contentId: res.data.contentId,
          playId: res.data.playId,
          suggestions: res.data.suggestions,
          preview: res.data.preview,
          approvalStatus: res.data.approvalStatus || (res.data.contentId ? 'assistant_draft' : null),
        },
      ]);
      if (res.data.conversationId) {
        setConversations((items) => {
          const found = items.find((item) => item.id === res.data.conversationId);
          if (found) {
            return [
              {
                ...found,
                title: res.data.conversationTitle || found.title,
                activeContentId: res.data.contentId || found.activeContentId,
                updatedAt: new Date().toISOString(),
              },
              ...items.filter((item) => item.id !== found.id),
            ];
          }
          return [
            {
              id: res.data.conversationId,
              title: res.data.conversationTitle || userMsg.slice(0, 80),
              activeContentId: res.data.contentId || null,
              updatedAt: new Date().toISOString(),
            },
            ...items,
          ];
        });
      }
      if (res.data.memoryEnabled) {
        void api<{ data: { enabled: boolean; memories: AssistantMemory[] } }>('/brand/chat/memory')
          .then((memoryRes) => setMemories(memoryRes.data.memories || []))
          .catch(() => undefined);
      }
    } catch (e) {
      if (isAbortError(e)) {
        setChatLog((l) => [...l, { role: 'assistant', text: 'Generation aborted.' }]);
      } else {
        const msg = e instanceof Error ? e.message : 'Chat failed';
        setError(msg);
        setChatLog((l) => [
          ...l,
          {
            role: 'assistant',
            text: `I couldn't complete that: ${msg}. Check Settings → Integrations for a text-model API key, then try again.`,
          },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  const abortChat = () => {
    abortRef.current?.abort();
    setBusy(false);
  };

  const askForIdeas = () => {
    void sendChat({
      text:
        brandType === 'b2c'
          ? 'Suggest post format variations for our brand this week — include Report (professional multi-block poster), countdown, launch, aesthetic, update, meme if brand-safe.'
          : 'Suggest post format variations for our B2B brand — prioritize Report (insight poster like agency creatives), launch, update, thought leadership, announcement.',
    });
  };

  const pickPlay = (play: PlaySuggestion) => {
    // Every format asks what exactly to post — never invent Offer/Countdown/etc.
    setBriefPlay(play);
    setActivePlayId(play.id);
    setBriefText('');

    // Templates are per format — never carry a previous format's layout over.
    const forPlay = posterTemplates.filter((t) => t.playId === play.id);
    setPosterTemplateId(null);
    if (designSource === 'template' && !forPlay.length) setDesignSource('ai');

    if (designSource === 'brand_template') {
      setVisualMode('existing_template');
      if (!selectedId && templates[0]?.id) setSelectedId(templates[0].id);
    } else {
      setVisualMode('new_poster');
    }
    setChatLog((l) => [
      ...l,
      {
        role: 'assistant',
          text: [
          `${play.label} — before I create anything, I need the exact post details.`,
          play.briefPrompt ||
            'Tell me what this post is about. I will not invent discounts, dates, features, or jokes.',
          `Next: pick how to design it — one of the ${forPlay.length || 3} ContentPilot layouts for this format, your own Brand Studio template, or a free AI poster.`,
        ].join('\n\n'),
        playId: play.id,
      },
    ]);
    requestAnimationFrame(() => {
      document.getElementById('ai-design-step')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const submitBrief = () => {
    if (!briefPlay || !briefText.trim() || busy) return;
    if (designSource === 'template' && !chosenTemplate) {
      setError('Pick one of the three layouts for this format, or switch to “Let AI design it”.');
      return;
    }
    if (designSource === 'brand_template' && !selectedId) {
      setError('Select one of your Brand Studio templates, or switch design source.');
      return;
    }
    if (
      designSource === 'template' &&
      chosenTemplate?.blocks.stat === 'required' &&
      !/\d/.test(briefText)
    ) {
      setError(
        `“${chosenTemplate.label}” needs a real number from you (a date, %, price, or metric). Add it to the brief — I will not invent one.`,
      );
      return;
    }
    const play = briefPlay;
    const detail = briefText.trim();
    const template = designSource === 'template' ? posterTemplateId : null;
    setBriefPlay(null);
    setBriefText('');
    void sendChat({
      text: `Generate a ${play.label} post using ONLY these facts (do not invent anything else):\n${detail}`,
      preferredPlay: play.id,
      posterTemplate: template,
      forceVisualMode: template
        ? 'new_poster'
        : designSource === 'brand_template' && selectedId
          ? 'existing_template'
          : 'new_poster',
    });
  };

  const isPlacid =
    selected?.provider === 'placid' || selected?.canvas?.designSource === 'placid';

  const featuredPlays = plays;

  return (
    <div className="page-container !max-w-6xl animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title inline-flex items-center gap-2">
            <MessageSquare className="text-brand-600" size={22} />
            AI Assistant
          </h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            Chat, write, revise, or create visuals only when you ask. Your conversation stays open until you send a draft to Approvals. Built for{' '}
            <span className="font-medium text-[hsl(var(--foreground))]">
              {brandType.toUpperCase()}
            </span>{' '}
            brands.
          </p>
        </div>
        <Link href="/brand-studio" className="btn-secondary min-h-[44px] w-full justify-center gap-2 shrink-0 sm:w-auto md:!min-h-[40px]">
          <Sparkles size={15} />
          Brand Studio
        </Link>
      </header>

      <div className="card !p-3 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            className="input min-h-[44px] flex-1"
            value={conversationId || ''}
            onChange={(e) => {
              if (e.target.value) void openConversation(e.target.value);
            }}
            aria-label="Conversation"
          >
            {!conversationId && <option value="">New conversation</option>}
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.title}
              </option>
            ))}
          </select>
          <button type="button" className="btn-secondary min-h-[44px] gap-2" onClick={() => void startNewConversation()}>
            <Plus size={15} /> New chat
          </button>
          <button
            type="button"
            className={`btn-secondary min-h-[44px] gap-2 ${memoryEnabled ? '!border-emerald-500/50 !text-emerald-700' : ''}`}
            onClick={() => setShowMemory((open) => !open)}
          >
            <Brain size={15} /> Memory {memoryEnabled ? 'on' : 'off'}
          </button>
        </div>

        {showMemory && (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 space-y-3">
            <Toggle
              checked={memoryEnabled}
              onCheckedChange={(enabled) => void toggleMemory(enabled)}
              label="Remember useful preferences"
              description="Optional. Stores durable brand/workflow preferences only; you can review or clear everything."
            />
            {memories.length > 0 ? (
              <div className="space-y-2">
                {memories.map((memory) => (
                  <div key={memory.id} className="flex items-start gap-2 rounded-lg border border-[hsl(var(--border))] p-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        {memory.category} · {memory.key}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed">{memory.value}</p>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost !p-2"
                      onClick={() => void deleteMemory(memory.id)}
                      aria-label="Forget this memory"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" className="btn-danger-outline text-xs" onClick={() => void clearMemories()}>
                  Clear all memory
                </button>
              </div>
            ) : (
              <p className="helper-text">
                No saved memories yet. When enabled, stable preferences such as tone, audience, and review workflow can be remembered.
              </p>
            )}
          </div>
        )}
      </div>

      {llmWarning && (
        <InlineNotice kind="info">
          {llmWarning}{' '}
          <Link href="/settings" className="underline font-medium">
            Open Settings
          </Link>
        </InlineNotice>
      )}
      {error && <InlineNotice kind="error">{error}</InlineNotice>}

      <details className="group">
        <summary className="card cursor-pointer !p-4 text-sm font-semibold">
          Image and poster studio <span className="font-normal text-[hsl(var(--muted-foreground))]">(optional)</span>
        </summary>
        <div className="mt-3 space-y-4">
      {/* Optional image workflow rail */}
      <ol className="card !p-3 flex flex-wrap gap-2 sm:gap-0 sm:divide-x sm:divide-[hsl(var(--border))]">
        {[
          { n: 1, label: 'Pick an image format' },
          { n: 2, label: 'Pick an image design' },
          { n: 3, label: 'Describe the visual' },
        ].map((s) => (
          <li
            key={s.n}
            className={`flex flex-1 items-center gap-2 px-3 py-1.5 text-sm ${
              workflowStep >= s.n ? 'text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]'
            }`}
          >
            <span
              className={`flex size-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                workflowStep > s.n
                  ? 'bg-brand-600 text-white'
                  : workflowStep === s.n
                    ? 'bg-brand-600/15 text-brand-700 ring-1 ring-brand-600/30'
                    : 'bg-[hsl(var(--muted))]'
              }`}
            >
              {workflowStep > s.n ? <Check size={12} /> : s.n}
            </span>
            <span className="font-medium">{s.label}</span>
          </li>
        ))}
      </ol>

      {/* 1 · Format  ·  2 · Design  ·  3 · Brief */}
      <div className="card !p-5 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-base font-semibold">Pick an image format</p>
            <p className="helper-text mt-0.5">
              Each format ships three designed layouts. After you pick one, choose a ContentPilot
              template, your Brand Studio plate, or a free AI poster. Colours and fonts always come
              from your Brand Kit in Settings.
            </p>
          </div>
          <ProcessingButton
            variant="secondary"
            className="min-h-[44px] md:!min-h-[36px] text-xs"
            icon={<Lightbulb size={14} />}
            disabled={busy}
            onClick={askForIdeas}
          >
            Suggest formats
          </ProcessingButton>
        </div>

        {featuredPlays.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {featuredPlays.map((p) => {
              const thumbs = posterTemplates.filter((t) => t.playId === p.id);
              const count = thumbs.length;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  onClick={() => pickPlay(p)}
                  className={`ai-play-card ${activePlayId === p.id ? 'ai-play-card-on' : ''}`}
                  title={p.description}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold leading-snug">{p.shortLabel}</p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${riskTone(p.risk)}`}
                    >
                      {p.risk}
                    </span>
                  </div>
                  <p className="mt-2 flex-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))] line-clamp-2">
                    {p.description || p.why}
                  </p>
                  <PosterTemplateStrip templates={thumbs} kit={brandKit} />
                  <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    {count ? `${count} templates` : p.format.replace(/_/g, ' ')}
                    {' · '}
                    {p.channels.slice(0, 2).join(' · ')}
                  </p>
                  <span className="mt-2 text-xs font-semibold text-brand-600">
                    {activePlayId === p.id ? 'Active' : 'Use format →'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {activePlayId && (
            <div className="space-y-4 border-t border-[hsl(var(--border))] pt-4" id="ai-design-step">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-base font-semibold">
                  How should we design{' '}
                  {plays.find((p) => p.id === activePlayId)?.shortLabel || 'this'}?
                </p>
                <p className="helper-text mt-0.5">
                  Colours, fonts and tone always come from your{' '}
                  <Link href="/settings" className="font-medium text-brand-600 underline">
                    Brand Kit
                  </Link>
                  . Layout is locked if you pick a ContentPilot template.
                </p>
              </div>
              <div className="flex items-center gap-1.5" aria-label="Brand kit colours">
                {(['primary', 'secondary', 'accent', 'background', 'text'] as const).map((k) => (
                  <span
                    key={k}
                    className="size-4 rounded-full ring-1 ring-black/10 dark:ring-white/15"
                    style={{ backgroundColor: brandKit.colors[k] }}
                    title={k}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  {
                    id: 'template' as const,
                    icon: <LayoutGrid size={18} />,
                    tone: 'bg-brand-500/15 text-brand-700',
                    title: 'ContentPilot template',
                    body: `${playTemplates.length || 3} layouts for this format. The AI fills them exactly — it cannot redesign the plate.`,
                  },
                  {
                    id: 'brand_template' as const,
                    icon: <LayoutTemplate size={18} />,
                    tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                    title: 'My brand template',
                    body: 'A plate you built in Brand Studio. Logo, header and footer stay put; only dynamic zones change.',
                  },
                  {
                    id: 'ai' as const,
                    icon: <Sparkles size={18} />,
                    tone: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
                    title: 'Let AI design it',
                    body: 'No fixed layout. Best when you want something fresh and are happy to iterate.',
                  },
                ]
              ).map((opt) => {
                const on = designSource === opt.id;
                const unavailable = opt.id === 'brand_template' && templates.length === 0;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={unavailable}
                    aria-pressed={on}
                    onClick={() => {
                      setDesignSource(opt.id);
                      setError('');
                      if (opt.id === 'brand_template') {
                        setVisualMode('existing_template');
                        setPosterTemplateId(null);
                        if (!selectedId && templates[0]?.id) setSelectedId(templates[0].id);
                      } else {
                        setVisualMode('new_poster');
                        setSelectedId('');
                        setPosterTemplateId(null);
                      }
                    }}
                    className={`ai-mode-card ${on ? 'ai-mode-card-on' : 'ai-mode-card-off'} ${
                      unavailable ? 'cursor-not-allowed opacity-55' : ''
                    }`}
                  >
                    <span
                      className={`mb-3 inline-flex size-10 items-center justify-center rounded-xl ${opt.tone}`}
                    >
                      {opt.icon}
                    </span>
                    <p className="text-base font-semibold">{opt.title}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                      {unavailable
                        ? 'No Brand Studio templates yet — create one first.'
                        : opt.body}
                    </p>
                    {on && (
                      <span className="mt-3 inline-flex rounded-full bg-brand-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                        Selected
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {designSource === 'template' && (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold">
                    Choose a layout
                    {playTemplates.length ? ` · ${playTemplates.length} for this format` : ''}
                  </p>
                  <p className="helper-text mt-0.5">
                  Thumbnails show the real poster layout in your Brand Kit colours.
                  </p>
                </div>
                {playTemplates.length > 0 ? (
                  <>
                    <PosterTemplatePicker
                      templates={playTemplates}
                      kit={brandKit}
                      selectedId={posterTemplateId}
                      onSelect={(id) => {
                        setPosterTemplateId(id);
                        setError('');
                      }}
                      disabled={busy}
                    />
                    {chosenTemplate && <TemplateLockNote template={chosenTemplate} />}
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-6 text-center">
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">
                      No layouts for this format — switch to “Let AI design it”.
                    </p>
                  </div>
                )}
              </div>
            )}

            {designSource === 'brand_template' && (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold">Choose your Brand Studio template</p>
                  <p className="helper-text mt-0.5">
                    Logo, header and footer stay put. Only the dynamic text/image zones change.
                  </p>
                </div>
                {templates.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {templates.map((t) => {
                      const on = selectedId === t.id;
                      const preview = t.previewUrl || t.backgroundUrl;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={busy}
                          aria-pressed={on}
                          onClick={() => {
                            setSelectedId(t.id);
                            setError('');
                          }}
                          className={`group flex flex-col overflow-hidden rounded-2xl border-2 text-left transition-all active:scale-[0.99] ${
                            on
                              ? 'border-brand-600 shadow-lg shadow-brand-600/15 ring-1 ring-brand-500/25'
                              : 'border-[hsl(var(--border))] hover:border-brand-500/40 hover:-translate-y-0.5'
                          }`}
                        >
                          <div className="relative aspect-[4/5] w-full overflow-hidden bg-[hsl(var(--muted))]">
                            {preview ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={mediaUrl(preview)}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-[hsl(var(--muted-foreground))]">
                                <LayoutTemplate size={28} />
                              </div>
                            )}
                            {on && (
                              <span className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full bg-brand-600 text-white shadow">
                                <Check size={13} />
                              </span>
                            )}
                          </div>
                          <div className="p-3">
                            <p className="text-sm font-semibold leading-snug">{t.name}</p>
                            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                              {t.provider === 'inhouse' || t.canvas?.designSource === 'inhouse'
                                ? 'In-house'
                                : 'Imported'}
                              {t.canvas?.postType ? ` · ${t.canvas.postType}` : ''}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-6 text-center">
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">No Brand Studio templates yet.</p>
                    <Link href="/brand-studio" className="mt-3 inline-flex text-sm text-brand-600 underline">
                      Create one in Brand Studio
                    </Link>
                  </div>
                )}
              </div>
            )}

            {designSource === 'ai' && (
              <div className="rounded-xl border border-dashed border-violet-500/30 bg-violet-500/[0.06] px-4 py-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                Free AI poster — layout is not locked. Colours, fonts and tone still follow your{' '}
                <Link href="/settings" className="font-medium text-brand-600 underline">
                  Brand Kit
                </Link>
                .
              </div>
            )}
          </div>
        )}
      </div>

      {visualMode === 'new_poster' && (
        <div className="card !p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold">Image generation options</p>
            <p className="helper-text mt-0.5">Logo from Settings · optional reference for style lock.</p>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-[hsl(var(--border))] p-3 sm:flex-row sm:items-center">
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[hsl(var(--muted))]">
              {brand?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(brand.logoUrl)} alt="Brand logo" className="max-h-12 max-w-12 object-contain" />
              ) : (
                <Sparkles size={18} className="text-[hsl(var(--muted-foreground))]" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{brand?.companyName || 'Company profile'}</p>
              <p className="helper-text">
                {brand?.logoUrl
                  ? 'Settings logo ready to stamp on new posters.'
                  : 'No logo in Settings yet — upload once under Company profile.'}
              </p>
            </div>
            <div className="sm:min-w-[220px]">
              <Toggle
                checked={includeLogo && Boolean(brand?.logoUrl)}
                onCheckedChange={setIncludeLogo}
                disabled={!brand?.logoUrl}
                label="Attach Settings logo"
                description="Composited onto the finished poster"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Post size</p>
            <div className="flex flex-wrap gap-2">
              {IMAGE_FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setImageFormat(f.id)}
                  className="chip"
                  data-active={imageFormat === f.id}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {designSource === 'ai' && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Image attachment (optional)</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                ['edit', 'Edit this image', 'Preserve it and change only what I ask'],
                ['style', 'Style reference', 'Create a new image in this visual style'],
                ['asset', 'Brand/product asset', 'Use this real asset in the new creative'],
              ] as const).map(([id, label, description]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAttachmentRole(id)}
                  className={`rounded-xl border p-2.5 text-left ${attachmentRole === id ? 'border-brand-600 bg-brand-600/[0.08]' : 'border-[hsl(var(--border))]'}`}
                >
                  <p className="text-xs font-semibold">{label}</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">{description}</p>
                </button>
              ))}
            </div>
            {referenceUrl ? (
              <ReferenceAttachmentPreview
                url={referenceUrl}
                fileName={referenceFileName}
                role={attachmentRole}
                onRoleChange={setAttachmentRole}
                onRemove={clearReference}
                uploading={uploadingRef}
              />
            ) : (
              <label
                className={`btn-secondary w-full sm:w-auto cursor-pointer ${uploadingRef ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <ImagePlus size={16} />
                {uploadingRef ? 'Uploading…' : 'Upload image'}
                <input
                  ref={refInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={uploadingRef}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadReference(file);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
          )}
        </div>
      )}
        </div>
      </details>

      <div
        className={`grid gap-4 ${
          visualMode === 'existing_template'
            ? 'lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]'
            : ''
        }`}
      >
        {visualMode === 'existing_template' && (
          <aside className="card !p-4 space-y-3 h-fit lg:sticky lg:top-20">
            <div>
              <p className="text-sm font-semibold">Templates</p>
              <p className="helper-text mt-0.5">Only dynamic zones change.</p>
            </div>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-14 w-full rounded-xl" />
                ))}
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-6 text-center">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">No templates yet.</p>
                <Link href="/brand-studio" className="mt-3 inline-flex text-sm text-brand-600 underline">
                  Create one in Brand Studio
                </Link>
              </div>
            ) : (
              <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
                {templates.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(t.id);
                        setError('');
                      }}
                      className={`w-full text-left rounded-2xl border-2 px-3.5 py-3 text-sm transition-all active:scale-[0.99] ${
                        selectedId === t.id
                          ? 'border-brand-600 bg-brand-600/10 shadow-md ring-1 ring-brand-500/20'
                          : 'border-[hsl(var(--border))] hover:border-brand-500/35 hover:bg-[hsl(var(--muted))]'
                      }`}
                    >
                      <span className="font-semibold">{t.name}</span>
                      <span className="mt-1 block text-[11px] text-[hsl(var(--muted-foreground))]">
                        {t.provider === 'inhouse' || t.canvas?.designSource === 'inhouse'
                          ? 'In-house template'
                          : 'Imported template'}
                        {t.canvas?.postType ? ` · ${t.canvas.postType}` : ''}
                      </span>
                      {selectedId === t.id && (
                        <span className="mt-2 inline-flex text-[10px] font-bold uppercase tracking-wide text-brand-700">
                          Selected
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}

        <section className="card flex min-h-[min(70vh,720px)] flex-col !p-4 sm:!p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">
                {visualMode === 'new_poster'
                  ? 'Creative studio'
                  : selected
                    ? selected.name
                    : 'Chat'}
              </h2>
              <p className="helper-text mt-0.5">
                {!visualMode
                  ? 'Ask questions, write or revise content, and create an image only when you request one.'
                  : visualMode === 'new_poster'
                    ? `${includeLogo && brand?.logoUrl ? 'Logo on · ' : 'Logo off · '}${IMAGE_FORMATS.find((f) => f.id === imageFormat)?.label}${referenceUrl ? ' · reference' : ''}${activePlayId ? ` · ${activePlayId}` : ''}`
                    : isPlacid
                      ? 'Imported template fill — only dynamic layers change.'
                      : 'Only dynamic zones change. Plate stays the same.'}
              </p>
            </div>
          </div>

          <div className="mb-3 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 sm:p-4 min-h-[320px]">
            {chatLog.length === 0 && !busy && (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 px-4 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-brand-600/10 text-brand-700">
                  <Lightbulb size={22} />
                </div>
                <div className="space-y-1 max-w-md">
                  <p className="text-sm font-semibold">What would you like to create or improve?</p>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    Ask for a caption, platform post, blog, script, campaign ideas, or an exact edit
                    to an attached image. No image is generated unless you ask for one.
                  </p>
                </div>
                <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                  <button type="button" className="btn-secondary min-h-[44px] md:!min-h-[40px] text-xs" onClick={askForIdeas}>
                    Suggest formats for us
                  </button>
                  {featuredPlays.slice(0, 3).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="ai-play-card !p-3"
                      onClick={() => pickPlay(p)}
                    >
                      <p className="text-sm font-semibold">{p.shortLabel}</p>
                      <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-2">
                        {p.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chatLog.map((m, i) => (
              <div
                key={i}
                className={`flex flex-col gap-2 ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-[hsl(var(--muted))]'
                  }`}
                >
                  {m.text}
                </div>

                {m.suggestions && m.suggestions.length > 0 && (
                  <div className="w-full max-w-[96%] space-y-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                      Pick a format card
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {m.suggestions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          disabled={busy}
                          onClick={() => pickPlay(s)}
                          className="ai-suggest-card group pl-5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-base font-semibold leading-snug">{s.label}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${riskTone(s.risk)}`}>
                              {s.risk}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))] line-clamp-3">
                            {s.why}
                          </p>
                          <p className="mt-3 text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
                            {s.channels.join(' · ')} · {s.format.replace('_', ' ')}
                          </p>
                          {s.caveat && (
                            <p className="mt-1 text-[11px] text-amber-700">{s.caveat}</p>
                          )}
                          <span className="mt-3 inline-flex text-sm font-semibold text-brand-600 group-hover:underline">
                            Generate this →
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {m.preview && (
                  <div className="w-full max-w-[96%] space-y-3 rounded-2xl border-2 border-brand-500/25 bg-gradient-to-br from-brand-500/[0.06] via-[hsl(var(--card))] to-[hsl(var(--card))] p-4 shadow-sm animate-fade-in">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                      Generated draft
                    </p>
                    {m.preview.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(m.preview.imageUrl)}
                        alt="Generated"
                        className="w-full rounded-xl border border-[hsl(var(--border))]"
                      />
                    )}
                    <p className="text-base font-semibold">{m.preview.headline}</p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                      {m.preview.body}
                    </p>
                    {m.preview.hashtags?.length > 0 && (
                      <p className="text-xs text-brand-600">
                        {m.preview.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
                      </p>
                    )}
                    {(m.preview.captions?.instagram || m.preview.captions?.linkedin) && (
                      <div className="grid gap-3 border-t border-[hsl(var(--border))] pt-3 sm:grid-cols-2">
                        {m.preview.captions.instagram && (
                          <div className="space-y-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                              Instagram
                            </p>
                            <p className="text-sm font-semibold">{m.preview.captions.instagram.headline}</p>
                            <p className="line-clamp-3 whitespace-pre-wrap text-xs text-[hsl(var(--muted-foreground))]">
                              {m.preview.captions.instagram.body}
                            </p>
                          </div>
                        )}
                        {m.preview.captions.linkedin && (
                          <div className="space-y-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                              LinkedIn
                            </p>
                            <p className="text-sm font-semibold">{m.preview.captions.linkedin.headline}</p>
                            <p className="line-clamp-3 whitespace-pre-wrap text-xs text-[hsl(var(--muted-foreground))]">
                              {m.preview.captions.linkedin.body}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    {m.contentId && (
                      submittedIds.has(m.contentId) || m.approvalStatus === 'pending_approval' ? (
                        <Link
                          href={`/approvals/${m.contentId}`}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white"
                        >
                          <Check size={12} /> Open in Approvals
                        </Link>
                      ) : (
                        <ProcessingButton
                          className="min-h-[44px] rounded-full text-xs"
                          loading={approvalBusyId === m.contentId}
                          loadingText="Sending…"
                          icon={<Check size={12} />}
                          onClick={() => void sendToApprovals(m.contentId!)}
                        >
                          Send to Approvals
                        </ProcessingButton>
                      )
                    )}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="w-full max-w-[92%] space-y-2 rounded-2xl bg-[hsl(var(--muted))] px-3 py-3">
                <ProgressBar
                  label={
                    activePlayId
                      ? `Creating ${activePlayId.replace(/_/g, ' ')}…`
                      : visualMode === 'new_poster'
                        ? includeLogo
                          ? 'Creating poster + attaching Settings logo…'
                          : 'Creating new poster…'
                        : 'Working…'
                  }
                />
                <button
                  type="button"
                  className="btn-danger-outline min-h-[44px] md:!min-h-[32px] !px-2.5 text-xs"
                  onClick={abortChat}
                >
                  <Square size={12} className="fill-current" />
                  Abort
                </button>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {briefPlay && (
            <div className="mb-3 space-y-3 rounded-2xl border border-brand-600/30 bg-brand-600/[0.06] p-3 sm:p-4 animate-fade-in">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    What exactly should we post? · {briefPlay.label}
                  </p>
                  <p className="helper-text mt-0.5">
                    {briefPlay.briefPrompt ||
                      'Share the real facts for this format. I will not invent discounts, dates, features, or jokes.'}
                  </p>
                  <p className="mt-1.5 text-[11px] font-medium text-brand-700 dark:text-brand-300">
                    {designSource === 'template'
                      ? chosenTemplate
                        ? `Design: ${chosenTemplate.label} template · brand colours from Settings`
                        : 'Pick one of the three layouts above before generating'
                      : designSource === 'brand_template'
                        ? `Design: ${selected?.name || 'your Brand Studio template'}`
                        : 'Design: free AI poster'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost min-h-[44px] md:!min-h-[32px] min-w-[44px] md:!min-w-[32px] !p-1.5"
                  onClick={() => {
                    setBriefPlay(null);
                    setBriefText('');
                  }}
                  aria-label="Close brief"
                >
                  <X size={14} />
                </button>
              </div>
              <textarea
                className="input min-h-[96px] text-sm"
                placeholder={
                  briefPlay.id === 'offer'
                    ? 'e.g. 20% off annual Pro plan through 30 Sep — code PRO20'
                    : briefPlay.id === 'countdown'
                      ? 'e.g. Product launch goes live Friday 12 Sep, 10am IST'
                      : briefPlay.id === 'meme'
                        ? 'e.g. Relatable pain: waiting on IT tickets for days — punchline about our auto-routing'
                        : briefPlay.id === 'launch'
                          ? 'e.g. We launched X — key benefit Y — CTA Book a demo'
                          : briefPlay.id === 'update'
                            ? 'e.g. What’s new: 1) … 2) … 3) …'
                            : briefPlay.id === 'insight_report'
                      ? 'e.g. Dubai ranked #2 globally for AI adoption (BCG). Reasons: … Callout: …'
                      : briefPlay.id === 'aesthetic'
                              ? 'e.g. Soft morning light on our skincare bottle — calm reset mood'
                              : briefPlay.id === 'thought_leadership'
                                ? 'e.g. Insight: most onboarding fails because…'
                                : briefPlay.id === 'announcement'
                                  ? 'e.g. We partnered with X to…'
                                  : 'Paste the exact post facts here…'
                }
                value={briefText}
                disabled={busy}
                onChange={(e) => setBriefText(e.target.value)}
              />
              <div className="space-y-2">
                {referenceUrl ? (
                  <ReferenceAttachmentPreview
                    url={referenceUrl}
                    fileName={referenceFileName}
                    role={attachmentRole}
                    onRoleChange={setAttachmentRole}
                    onRemove={clearReference}
                    uploading={uploadingRef}
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className={`btn-secondary min-h-[44px] md:!min-h-[36px] text-xs cursor-pointer ${uploadingRef ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    <ImagePlus size={14} />
                    {uploadingRef
                      ? 'Uploading…'
                      : referenceUrl
                        ? 'Replace image'
                        : 'Upload image (optional)'}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      disabled={uploadingRef || busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setVisualMode('new_poster');
                          void uploadReference(file);
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <ProcessingButton
                    className="min-h-[44px] md:!min-h-[36px] text-xs ml-auto"
                    disabled={briefText.trim().length < 12 || busy || !readyToGenerate}
                    icon={<Sparkles size={14} />}
                    onClick={() => void submitBrief()}
                  >
                    Generate with these details
                  </ProcessingButton>
                </div>
              </div>
            </div>
          )}

          <div className="mb-2 flex flex-wrap items-center gap-2">
            {([
              ['auto', <Sparkles key="auto" size={13} />, 'Auto'],
              ['text', <FileText key="text" size={13} />, 'Text only'],
              ['image', <Image key="image" size={13} />, 'Image'],
            ] as const).map(([id, icon, label]) => (
              <button
                key={id}
                type="button"
                className="chip inline-flex items-center gap-1.5"
                data-active={outputMode === id}
                onClick={() => setOutputMode(id)}
              >
                {icon} {label}
              </button>
            ))}
            <label className={`chip ml-auto inline-flex cursor-pointer items-center gap-1.5 ${uploadingRef ? 'pointer-events-none opacity-60' : ''}`}>
              <ImagePlus size={13} />
              {referenceUrl ? 'Replace image' : 'Attach image'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={uploadingRef || busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadReference(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {(referenceUrl || uploadingRef) && (
            <div className="mb-2">
              {referenceUrl ? (
                <ReferenceAttachmentPreview
                  url={referenceUrl}
                  fileName={referenceFileName}
                  role={attachmentRole}
                  onRoleChange={setAttachmentRole}
                  onRemove={clearReference}
                  uploading={uploadingRef}
                  compact
                />
              ) : (
                <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                  Uploading image…
                </div>
              )}
            </div>
          )}

          <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-20 -mx-3 mt-2 flex gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]/95 px-3 py-3 shadow-[0_-8px_24px_rgb(15_23_42/0.08)] backdrop-blur-md sm:-mx-4 sm:px-4 md:static md:mx-0 md:mt-0 md:border-0 md:bg-transparent md:p-0 md:shadow-none">
            <textarea
              className="input min-h-[52px] flex-1 resize-y"
              rows={2}
              maxLength={12000}
              placeholder={
                outputMode === 'text'
                  ? 'Write a LinkedIn post, caption, blog, script…'
                  : outputMode === 'image'
                    ? referenceUrl && attachmentRole === 'edit'
                      ? 'Describe the exact change; everything else stays unchanged…'
                      : 'Describe the image or poster to create…'
                    : 'Ask anything, write content, or explicitly request an image…'
              }
              value={message}
              disabled={busy}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendChat();
                }
              }}
            />
            {busy ? (
              <ProcessingButton
                className="!min-h-[44px] !min-w-[48px] !px-3"
                variant="danger-outline"
                icon={<Square size={16} className="fill-current" />}
                onClick={abortChat}
                aria-label="Abort generation"
              >
                <span className="sr-only">Abort</span>
              </ProcessingButton>
            ) : (
              <ProcessingButton
                className="!min-h-[44px] !min-w-[48px] !px-3"
                disabled={!canChat}
                loading={false}
                loadingText=""
                icon={<Send size={18} />}
                onClick={() => void sendChat()}
                aria-label="Send message"
              >
                <span className="sr-only">Send</span>
              </ProcessingButton>
            )}
          </div>
        </section>
      </div>

      <ProcessOverlay
        open={busy}
        title="AI Assistant"
        description="Thinking, writing, or creating your requested visual — abort to stop waiting."
        onCancel={() => abortChat()}
        cancelLabel="Abort"
      />
    </div>
  );
}

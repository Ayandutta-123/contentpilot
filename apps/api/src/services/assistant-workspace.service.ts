import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { LLMService, buildSystemPrompt } from './llm.service';
import { runBrandAssistant, type VisualMode } from './brand-chat.service';
import { attachGeneratedImage } from './image-attach.service';
import { buildPlatformCaptionsFromIntent, normalizeHashtags } from './platform-captions';
import { notifySuccess } from './app-notification.service';
import { notifyApprovalPending } from '../providers/notifications';
import { resolveReferenceDataUri, resolveReferencePublicUrl } from './reference-style.service';

export type AssistantOutputMode = 'auto' | 'text' | 'image';
export type AssistantAttachmentRole = 'edit' | 'style' | 'asset';

export type AssistantTurnInput = {
  tenantId: string;
  conversationId?: string | null;
  message: string;
  outputMode?: AssistantOutputMode;
  attachmentUrl?: string | null;
  attachmentRole?: AssistantAttachmentRole | null;
  activeContentId?: string | null;
  brandTemplateId?: string | null;
  visualMode?: VisualMode | null;
  includeLogo?: boolean;
  imageFormat?: 'instagram_square' | 'instagram_portrait' | 'linkedin' | 'story';
  preferredPlay?: string | null;
  posterTemplateId?: string | null;
};

type AssistantIntent = {
  kind: 'chat' | 'social_text' | 'long_form' | 'image_create' | 'image_edit';
  responseText?: string;
  headline?: string;
  body?: string;
  hashtags?: unknown;
  callToAction?: string | null;
  captions?: unknown;
  memoryItems?: Array<{ key?: unknown; value?: unknown; category?: unknown }>;
};

function cleanMemoryKey(raw: unknown): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function memoryBlock(memories: Array<{ key: string; value: string; category: string }>): string {
  if (!memories.length) return 'No saved assistant memories.';
  return memories.map((m) => `- [${m.category}] ${m.key}: ${m.value}`).join('\n');
}

async function ensureConversation(tenantId: string, conversationId?: string | null) {
  if (conversationId) {
    const found = await prisma.assistantConversation.findFirst({
      where: { id: conversationId, tenantId, deletedAt: null },
    });
    if (found) return found;
  }
  return prisma.assistantConversation.create({
    data: { tenantId },
  });
}

async function persistMemories(
  tenantId: string,
  conversationId: string,
  items: AssistantIntent['memoryItems'],
) {
  for (const item of (items || []).slice(0, 6)) {
    const key = cleanMemoryKey(item.key);
    const value = String(item.value || '').replace(/\s+/g, ' ').trim().slice(0, 800);
    const category = String(item.category || 'preference').trim().slice(0, 40);
    if (!key || value.length < 3) continue;
    await prisma.assistantMemory.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: {
        tenantId,
        key,
        value,
        category,
        sourceConversationId: conversationId,
      },
      update: {
        value,
        category,
        sourceConversationId: conversationId,
        isActive: true,
      },
    });
  }
}

export async function runAssistantWorkspaceTurn(input: AssistantTurnInput) {
  const conversation = await ensureConversation(input.tenantId, input.conversationId);
  const [brand, memories, recent] = await Promise.all([
    prisma.brandSettings.findUnique({ where: { tenantId: input.tenantId } }),
    prisma.assistantMemory.findMany({
      where: { tenantId: input.tenantId, isActive: true },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { key: true, value: true, category: true },
    }),
    prisma.assistantMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ]);
  const memoryEnabled = brand?.assistantMemoryEnabled === true;
  const history = recent
    .reverse()
    .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content }));

  await prisma.assistantMessage.create({
    data: {
      conversationId: conversation.id,
      tenantId: input.tenantId,
      role: 'user',
      content: input.message,
      attachmentUrl: input.attachmentUrl || null,
      attachmentRole: input.attachmentRole || null,
    },
  });

  const activeContentId = input.activeContentId || conversation.activeContentId;
  const activeContent = activeContentId
    ? await prisma.generatedContent.findFirst({
        where: { id: activeContentId, tenantId: input.tenantId, deletedAt: null },
      })
    : null;

  const llm = await LLMService.forTenant(input.tenantId);
  const requestedMode = input.outputMode || 'auto';
  const intentRaw = await llm.generateRawJson({
    maxTokens: 8192,
    systemPrompt: `${buildSystemPrompt(brand ?? {
      brandVoice: '',
      imageStyle: '',
      hashtagStrategy: '',
      contentGuidelines: '',
      targetAudience: '',
    })}

You are a persistent, conversational creative assistant like Claude or ChatGPT.
Do not generate an image unless the user explicitly asks for an image, poster, visual, graphic, or an edit to an image.
You can answer questions and write/rewrite captions, platform posts, blogs, scripts, ideas, hashtags, and long-form copy.

Classify this turn:
- chat: advice, questions, brainstorming, or normal conversation with no draft requested.
- social_text: social caption/post/copy requested without an image.
- long_form: blog, article, newsletter copy, script, or other long-form writing.
- image_create: user explicitly asks to create a new image/poster/visual.
- image_edit: user asks to change an uploaded/current image while preserving everything else.

Requested output mode: ${requestedMode}. If "text", never choose an image kind. If "image", choose image_edit when a source image exists, otherwise image_create.
Current editable content: ${activeContent?.imageUrl ? `YES (${activeContent.imageUrl})` : 'NO'}.
Attachment: ${input.attachmentUrl ? `${input.attachmentRole || 'style'} (${input.attachmentUrl})` : 'none'}.

MEMORY:
${memoryEnabled ? memoryBlock(memories) : 'Memory is OFF. Do not infer or return memoryItems.'}

When memory is ON, return memoryItems only for durable user-approved facts/preferences useful in future sessions.
Never store passwords, API keys, secrets, financial/medical data, or transient requests.

Return JSON:
{
  "kind": "chat|social_text|long_form|image_create|image_edit",
  "responseText": "natural assistant response or full requested text",
  "headline": "draft headline if content was requested",
  "body": "complete requested copy",
  "hashtags": ["without #"],
  "callToAction": "optional",
  "captions": {
    "instagram": {"headline":"","body":"","hashtags":[],"callToAction":null},
    "linkedin": {"headline":"","body":"","hashtags":[],"callToAction":null}
  },
  "memoryItems": [{"key":"stable_key","value":"durable preference/fact","category":"preference|brand|audience|workflow"}]
}`,
    userPrompt: `Conversation:
${history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n') || '(new conversation)'}

USER: ${input.message}`,
  });
  const intent = intentRaw as AssistantIntent;

  if (memoryEnabled) {
    await persistMemories(input.tenantId, conversation.id, intent.memoryItems);
  }

  let assistantMessage = String(intent.responseText || '').trim();
  let contentId: string | null = null;
  let preview: Record<string, unknown> | undefined;
  let kind = intent.kind;
  if (!['chat', 'social_text', 'long_form', 'image_create', 'image_edit'].includes(kind)) {
    kind = requestedMode === 'image' ? (activeContent?.imageUrl ? 'image_edit' : 'image_create') : 'chat';
  }

  if (kind === 'image_create') {
    const result = await runBrandAssistant({
      tenantId: input.tenantId,
      brandTemplateId: input.brandTemplateId,
      message: input.message,
      history,
      visualMode: input.visualMode || 'new_poster',
      includeLogo: input.includeLogo,
      referenceImageUrl:
        input.attachmentRole === 'style' || input.attachmentRole === 'asset'
          ? input.attachmentUrl
          : null,
      imageFormat: input.imageFormat,
      preferredPlay: input.preferredPlay,
      posterTemplateId: input.posterTemplateId,
    });
    assistantMessage = result.assistantMessage;
    contentId = result.contentId || null;
    preview = result.preview;
  } else if (kind === 'image_edit') {
    const sourceUrl =
      input.attachmentRole === 'edit' && input.attachmentUrl
        ? input.attachmentUrl
        : activeContent?.imageUrl || null;
    if (!sourceUrl) {
      assistantMessage =
        'Upload the image you want me to edit and choose “Edit this image”, or generate an image first.';
      kind = 'chat';
    } else {
      const canReviseActive =
        activeContent &&
        (activeContent.status === 'assistant_draft' || activeContent.status === 'generating');
      const target =
        canReviseActive
          ? activeContent
          : await prisma.generatedContent.create({
          data: {
            tenantId: input.tenantId,
            engine: 'brand_chat',
            status: 'generating',
            headline: String(intent.headline || activeContent?.headline || 'Edited image'),
            body: String(intent.body || activeContent?.body || ''),
            hashtags: activeContent?.hashtags || [],
            callToAction: activeContent?.callToAction || null,
            platformCaptions: activeContent?.platformCaptions || undefined,
            sourceReference: `AI Assistant image edit: ${conversation.id}`,
          },
        });
      const editPrompt = [
        'Edit the supplied source image.',
        `Requested change: ${input.message}`,
        'Preserve every unmentioned element exactly: composition, subjects, faces, objects, typography, logo, colors, lighting, crop, aspect ratio, and spacing.',
        'Do not redesign, restyle, add text, remove text, or change branding unless explicitly requested.',
        'Apply only the smallest localized change necessary.',
      ].join(' ');
      const providerSource = /^https?:\/\//i.test(sourceUrl) || sourceUrl.startsWith('data:')
        ? resolveReferencePublicUrl(sourceUrl)
        : await resolveReferenceDataUri(sourceUrl);
      const edited = await attachGeneratedImage(input.tenantId, target.id, editPrompt, {
        rawOnly: true,
        exact: true,
        editMode: true,
        referenceImageUrl: providerSource,
        format: input.imageFormat || 'instagram_square',
        throwOnError: true,
        savePrompt: true,
        skipPersist: false,
        designSource: 'ai',
      });
      await prisma.generatedContent.update({
        where: { id: target.id },
        data: {
          status: 'assistant_draft',
          imageUrl: edited?.imageUrl || target.imageUrl,
          revisionCount: { increment: 1 },
        },
      });
      contentId = target.id;
      assistantMessage = assistantMessage || 'I applied only the requested change and kept the rest of the image intact.';
      preview = {
        headline: target.headline || 'Edited image',
        body: target.body || '',
        hashtags: target.hashtags || [],
        imageUrl: edited?.imageUrl || target.imageUrl,
      };
    }
  } else if (kind === 'social_text' || kind === 'long_form') {
    const headline = String(intent.headline || (kind === 'long_form' ? 'Draft' : 'Social post')).trim();
    const body = String(intent.body || intent.responseText || '').trim();
    const hashtags = normalizeHashtags(intent.hashtags);
    const callToAction =
      typeof intent.callToAction === 'string' && intent.callToAction.trim()
        ? intent.callToAction.trim()
        : null;
    const platformCaptions = buildPlatformCaptionsFromIntent(intentRaw, {
      headline,
      body,
      hashtags,
      callToAction,
    });
    const draft = await prisma.generatedContent.create({
      data: {
        tenantId: input.tenantId,
        engine: 'brand_chat',
        status: 'assistant_draft',
        headline,
        body,
        hashtags,
        callToAction,
        platformCaptions,
        sourceReference: `AI Assistant ${kind}: ${conversation.id}`,
      },
    });
    contentId = draft.id;
    assistantMessage = assistantMessage || body;
    preview = { headline, body, hashtags, callToAction, captions: platformCaptions, imageUrl: null };
  }

  if (!assistantMessage) assistantMessage = 'How would you like me to refine this?';

  const savedAssistant = await prisma.assistantMessage.create({
    data: {
      conversationId: conversation.id,
      tenantId: input.tenantId,
      role: 'assistant',
      content: assistantMessage,
      contentId,
      metadata: { kind, preview: preview || null } as Prisma.InputJsonValue,
    },
  });
  const updatedConversation = await prisma.assistantConversation.update({
    where: { id: conversation.id },
    data: {
      activeContentId: contentId || activeContentId || null,
      title:
        conversation.title === 'New conversation'
          ? input.message.replace(/\s+/g, ' ').trim().slice(0, 80)
          : conversation.title,
    },
  });

  return {
    conversationId: conversation.id,
    conversationTitle: updatedConversation.title,
    messageId: savedAssistant.id,
    action: kind,
    assistantMessage,
    contentId,
    preview,
    memoryEnabled,
    approvalStatus: contentId ? 'assistant_draft' : null,
  };
}

export async function submitAssistantDraftForApproval(tenantId: string, contentId: string) {
  const content = await prisma.generatedContent.findFirst({
    where: { id: contentId, tenantId, deletedAt: null },
  });
  if (!content) throw new Error('Assistant draft not found');
  if (content.status !== 'assistant_draft') {
    if (content.status === 'pending_approval') return content;
    throw new Error(`Only assistant drafts can be sent to Approvals (current: ${content.status})`);
  }
  const updated = await prisma.generatedContent.update({
    where: { id: content.id },
    data: { status: 'pending_approval' },
  });
  await notifyApprovalPending(updated);
  await notifySuccess(
    tenantId,
    'Content ready for review',
    updated.headline || 'AI Assistant draft',
    `/approvals/${updated.id}`,
  );
  return updated;
}

import { z } from 'zod';

// ── Roles ──────────────────────────────────────────────────
export enum UserRole {
  ADMIN = 'admin',
  REVIEWER = 'reviewer',
  VIEWER = 'viewer',
}

// ── Content Engine Types ───────────────────────────────────
export enum ContentEngine {
  TRENDS = 'trends',
  COMPETITOR = 'competitor',
  NEWSLETTER = 'newsletter',
  BRAND_CHAT = 'brand_chat',
  CALENDAR = 'calendar',
  MEME = 'meme',
  CAROUSEL = 'carousel',
  /** @deprecated kept for existing DB rows — use NEWSLETTER */
  LIBRARY = 'library',
}

export enum ContentStatus {
  GENERATING = 'generating',
  ASSISTANT_DRAFT = 'assistant_draft',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  SCHEDULED = 'scheduled',
  REJECTED = 'rejected',
  PUBLISHING = 'publishing',
  PUBLISHED = 'published',
  FAILED = 'failed',
  MANUAL_INTERVENTION = 'manual_intervention',
}

export enum ApprovalAction {
  APPROVE = 'approve',
  REJECT_REGENERATE = 'reject_regenerate',
  REJECT_EDIT = 'reject_edit',
}

export enum Platform {
  INSTAGRAM = 'instagram',
  LINKEDIN = 'linkedin',
  FACEBOOK = 'facebook',
}

export enum ExecutionStatus {
  RUNNING = 'running',
  SUCCESS = 'success',
  TRANSIENT_FAILURE = 'transient_failure',
  HARD_FAILURE = 'hard_failure',
}

export enum NotificationChannel {
  SLACK = 'slack',
  TEAMS = 'teams',
  EMAIL = 'email',
  IN_APP = 'in_app',
}

// ── LLM Output Schemas ─────────────────────────────────────
export const GeneratedPostSchema = z.object({
  headline: z.string().max(120),
  body: z.string().max(2200),
  hashtags: z.array(z.string()).max(30),
  callToAction: z.string().max(100).optional(),
  imagePrompt: z.string().max(8000).optional(),
  sourceAttribution: z.string().max(200).optional(),
});

export type GeneratedPost = z.infer<typeof GeneratedPostSchema>;

export const RegeneratedPostSchema = GeneratedPostSchema.extend({
  revisionNotes: z.string().optional(),
});

export type RegeneratedPost = z.infer<typeof RegeneratedPostSchema>;

// ── API Request/Response Types ─────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RotationStatusItem {
  id: string;
  name: string;
  engine: ContentEngine;
  isActive: boolean;
  lastUsedAt: string | null;
  rotationOrder: number;
}

export interface ApprovalDecisionInput {
  contentId: string;
  action: ApprovalAction;
  feedback?: string;
  editedContent?: Partial<GeneratedPost>;
  platforms?: Platform[];
}

export interface ContentPreview {
  id: string;
  engine: ContentEngine;
  status: ContentStatus;
  headline: string;
  body: string;
  hashtags: string[];
  imageUrl?: string;
  revisionCount: number;
  createdAt: string;
  sourceReference?: string;
}

export {
  MAX_REVISION_CYCLES,
  PUBLISH_POLL_INTERVAL_MS,
  PUBLISH_POLL_MAX_ATTEMPTS,
  LLM_MAX_TOKENS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  MEDIA_SIGNED_URL_TTL_SECONDS,
  CHARACTER_LIMITS,
  WS_EVENTS,
  QUEUE_NAMES,
} from './constants';

export {
  OPENAI_MODELS,
  CLAUDE_MODELS,
  CLAUDE_MODEL_MIGRATIONS,
  resolveClaudeModelId,
  FAL_IMAGE_MODELS,
  OPENAI_IMAGE_MODELS,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_FAL_MODEL,
  DEFAULT_OPENAI_IMAGE_MODEL,
} from './models';
export type { ModelOption } from './models';

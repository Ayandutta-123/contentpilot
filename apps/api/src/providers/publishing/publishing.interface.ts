export interface PublishContent {
  headline: string;
  body: string;
  hashtags: string[];
  /** Public HTTPS URL (Instagram/Facebook) */
  imageUrl?: string;
  /** Local /uploads or data path for binary upload (LinkedIn) */
  localImageUrl?: string;
  /** Multi-image carousel (Instagram). Cover is still imageUrl. */
  imageUrls?: string[];
  callToAction?: string;
}

export interface PublishResult {
  success: boolean;
  platformPostId?: string;
  containerId?: string;
  error?: string;
  needsPolling?: boolean;
}

export interface MediaContainerStatus {
  status: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED';
  errorMessage?: string;
}

export interface PlatformPublisher {
  readonly platform: string;
  publish(content: PublishContent, accessToken: string, accountId: string): Promise<PublishResult>;
  checkMediaStatus?(containerId: string, accessToken: string): Promise<MediaContainerStatus>;
  refreshToken?(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }>;
}

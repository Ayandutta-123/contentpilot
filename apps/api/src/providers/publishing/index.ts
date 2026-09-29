import type { PlatformPublisher, PublishContent, PublishResult, MediaContainerStatus } from './publishing.interface';
import { loadImageBytesForPublish, toInstagramJpeg } from '../../lib/publishable-image';

export class InstagramPublisher implements PlatformPublisher {
  readonly platform = 'instagram';
  private baseUrl = 'https://graph.facebook.com/v21.0';

  async publish(
    content: PublishContent,
    accessToken: string,
    accountId: string,
  ): Promise<PublishResult> {
    if (!accountId.trim()) {
      return {
        success: false,
        error:
          'Instagram Business Account ID is missing. Reconnect Instagram in Settings → Publish.',
      };
    }

    const caption = this.formatCaption(content);

    const slideUrls = (content.imageUrls?.length ? content.imageUrls : content.imageUrl ? [content.imageUrl] : [])
      .map((u) => u.trim())
      .filter(Boolean);

    if (!slideUrls.length) {
      return { success: false, error: 'Instagram requires an image for publishing' };
    }
    for (const url of slideUrls) {
      if (!/^https:\/\//i.test(url) || /localhost|127\.0\.0\.1|storage\.placid\.app/i.test(url)) {
        return {
          success: false,
          error:
            'Instagram requires a publicly reachable HTTPS image URL. Re-publish after the image is hosted, or set a public API_URL.',
        };
      }
    }

    // Single image
    if (slideUrls.length === 1) {
      const containerRes = await fetch(`${this.baseUrl}/${accountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: slideUrls[0],
          caption,
          access_token: accessToken,
        }),
      });

      if (!containerRes.ok) {
        const err = await containerRes.text();
        return { success: false, error: `Instagram container creation failed: ${err}` };
      }

      const container = (await containerRes.json()) as { id: string };
      return {
        success: true,
        containerId: container.id,
        needsPolling: true,
      };
    }

    // Carousel: create child items, then parent CAROUSEL container
    const childIds: string[] = [];
    for (let i = 0; i < slideUrls.length; i++) {
      const childRes = await fetch(`${this.baseUrl}/${accountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: slideUrls[i],
          is_carousel_item: true,
          access_token: accessToken,
        }),
      });
      if (!childRes.ok) {
        return {
          success: false,
          error: `Instagram carousel item ${i + 1} failed: ${await childRes.text()}`,
        };
      }
      const child = (await childRes.json()) as { id: string };
      childIds.push(child.id);
    }

    // Wait for children to finish processing before creating the parent
    for (const childId of childIds) {
      const ready = await this.waitUntilFinished(childId, accessToken);
      if (!ready.ok) {
        return { success: false, error: ready.error || 'Carousel item processing failed' };
      }
    }

    const parentRes = await fetch(`${this.baseUrl}/${accountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption,
        access_token: accessToken,
      }),
    });

    if (!parentRes.ok) {
      return {
        success: false,
        error: `Instagram carousel container failed: ${await parentRes.text()}`,
      };
    }

    const parent = (await parentRes.json()) as { id: string };
    return {
      success: true,
      containerId: parent.id,
      needsPolling: true,
    };
  }

  private async waitUntilFinished(
    containerId: string,
    accessToken: string,
  ): Promise<{ ok: boolean; error?: string }> {
    for (let attempt = 1; attempt <= 30; attempt++) {
      const status = await this.checkMediaStatus(containerId, accessToken);
      if (status.status === 'FINISHED') return { ok: true };
      if (status.status === 'ERROR' || status.status === 'EXPIRED') {
        return { ok: false, error: status.errorMessage || `Carousel item ${containerId} failed` };
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { ok: false, error: `Carousel item ${containerId} timed out` };
  }

  async checkMediaStatus(containerId: string, accessToken: string): Promise<MediaContainerStatus> {
    const res = await fetch(
      `${this.baseUrl}/${containerId}?fields=status_code&access_token=${accessToken}`,
    );
    if (!res.ok) {
      return { status: 'ERROR', errorMessage: await res.text() };
    }
    const data = (await res.json()) as { status_code: string };
    const statusMap: Record<string, MediaContainerStatus['status']> = {
      IN_PROGRESS: 'IN_PROGRESS',
      FINISHED: 'FINISHED',
      ERROR: 'ERROR',
      EXPIRED: 'EXPIRED',
    };
    return { status: statusMap[data.status_code] ?? 'ERROR' };
  }

  async publishContainer(
    containerId: string,
    accessToken: string,
    accountId: string,
  ): Promise<PublishResult> {
    const res = await fetch(`${this.baseUrl}/${accountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: accessToken,
      }),
    });

    if (!res.ok) {
      return { success: false, error: `Instagram publish failed: ${await res.text()}` };
    }

    const data = (await res.json()) as { id: string };
    return { success: true, platformPostId: data.id };
  }

  private formatCaption(content: PublishContent): string {
    const hashtags = content.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
    let caption = `${content.headline}\n\n${content.body}`;
    if (content.callToAction) caption += `\n\n${content.callToAction}`;
    if (hashtags) caption += `\n\n${hashtags}`;
    return caption.slice(0, 2200);
  }
}

export class LinkedInPublisher implements PlatformPublisher {
  readonly platform = 'linkedin';

  async publish(
    content: PublishContent,
    accessToken: string,
    accountId: string,
  ): Promise<PublishResult> {
    const text = this.formatPost(content);
    const authorUrn = accountId.startsWith('urn:') ? accountId : `urn:li:person:${accountId}`;

    let media: Array<Record<string, unknown>> | undefined;
    const sourceImage = content.localImageUrl || content.imageUrl;
    if (sourceImage) {
      try {
        const asset = await this.uploadImageAsset(sourceImage, accessToken, authorUrn);
        media = [
          {
            status: 'READY',
            description: { text: content.headline.slice(0, 200) },
            media: asset,
            title: { text: content.headline.slice(0, 200) },
          },
        ];
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `LinkedIn image upload failed: ${msg}` };
      }
    }

    const body: Record<string, unknown> = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: media?.length ? 'IMAGE' : 'NONE',
          ...(media?.length ? { media } : {}),
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };

    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return { success: false, error: `LinkedIn publish failed: ${await res.text()}` };
    }

    const data = (await res.json()) as { id: string };
    return { success: true, platformPostId: data.id };
  }

  /** Register + PUT binary image via LinkedIn Assets API (works with local /uploads). */
  private async uploadImageAsset(
    imageUrl: string,
    accessToken: string,
    ownerUrn: string,
  ): Promise<string> {
    const loaded = await loadImageBytesForPublish(imageUrl);
    if (!loaded) throw new Error('Could not read image file for LinkedIn');
    // LinkedIn accepts PNG/JPEG; normalize exotic formats
    const prepared =
      /image\/(png|jpe?g)/i.test(loaded.mimetype) && !/\.svg$/i.test(loaded.filename)
        ? loaded
        : await toInstagramJpeg(loaded);

    const registerRes = await fetch(
      'https://api.linkedin.com/v2/assets?action=registerUpload',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          registerUploadRequest: {
            owner: ownerUrn,
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            serviceRelationships: [
              {
                identifier: 'urn:li:userGeneratedContent',
                relationshipType: 'OWNER',
              },
            ],
            supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD'],
          },
        }),
      },
    );
    if (!registerRes.ok) {
      throw new Error(`registerUpload failed: ${(await registerRes.text()).slice(0, 400)}`);
    }
    const registered = (await registerRes.json()) as {
      value?: {
        asset?: string;
        uploadMechanism?: {
          'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'?: {
            uploadUrl?: string;
          };
        };
      };
    };
    const uploadUrl =
      registered.value?.uploadMechanism?.[
        'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
      ]?.uploadUrl;
    const asset = registered.value?.asset;
    if (!uploadUrl || !asset) {
      throw new Error('LinkedIn registerUpload returned no uploadUrl/asset');
    }

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': prepared.mimetype || 'application/octet-stream',
      },
      body: new Uint8Array(prepared.buffer),
    });
    if (!putRes.ok) {
      throw new Error(`LinkedIn binary upload failed (${putRes.status})`);
    }
    return asset;
  }

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const { config } = await import('../../config');
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.LINKEDIN_CLIENT_ID ?? '',
      client_secret: config.LINKEDIN_CLIENT_SECRET ?? '',
    });

    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!res.ok) throw new Error(`LinkedIn token refresh failed: ${await res.text()}`);
    const data = await res.json() as { access_token: string; expires_in: number };
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  private formatPost(content: PublishContent): string {
    const hashtags = content.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
    let text = `${content.headline}\n\n${content.body}`;
    if (content.callToAction) text += `\n\n${content.callToAction}`;
    if (hashtags) text += `\n\n${hashtags}`;
    return text;
  }
}

export class FacebookPublisher implements PlatformPublisher {
  readonly platform = 'facebook';
  private baseUrl = 'https://graph.facebook.com/v21.0';

  async publish(
    content: PublishContent,
    accessToken: string,
    accountId: string,
  ): Promise<PublishResult> {
    const message = this.formatPost(content);
    const endpoint = content.imageUrl
      ? `${this.baseUrl}/${accountId}/photos`
      : `${this.baseUrl}/${accountId}/feed`;

    const body: Record<string, string> = {
      message,
      access_token: accessToken,
    };
    if (content.imageUrl) body.url = content.imageUrl;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return { success: false, error: `Facebook publish failed: ${await res.text()}` };
    }

    const data = await res.json() as { id: string; post_id?: string };
    return { success: true, platformPostId: data.post_id ?? data.id };
  }

  private formatPost(content: PublishContent): string {
    const hashtags = content.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
    let text = `${content.headline}\n\n${content.body}`;
    if (content.callToAction) text += `\n\n${content.callToAction}`;
    if (hashtags) text += `\n\n${hashtags}`;
    return text;
  }
}

const publishers: Record<string, PlatformPublisher> = {
  instagram: new InstagramPublisher(),
  linkedin: new LinkedInPublisher(),
  facebook: new FacebookPublisher(),
};

export function getPublisher(platform: string): PlatformPublisher {
  const publisher = publishers[platform];
  if (!publisher) throw new Error(`No publisher configured for platform: ${platform}`);
  return publisher;
}

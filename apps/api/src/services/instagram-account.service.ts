const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

type InstagramAccount = {
  id: string;
  username?: string;
};

type FacebookPage = {
  id: string;
  name: string;
  instagram_business_account?: InstagramAccount;
};

async function graphJson<T>(path: string, accessToken: string): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, '')}`);
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url);
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  if (!response.ok || data.error) {
    const message = data.error?.message || `Meta Graph API returned HTTP ${response.status}`;
    throw new Error(`Instagram connection validation failed: ${message}`);
  }
  return data;
}

/**
 * Resolve the Instagram Professional account attached to a Facebook Page.
 * Publishing requires this IG User ID, not the Page ID, username, or a blank value.
 */
export async function resolveInstagramPublishingAccount(opts: {
  accessToken: string;
  requestedAccountId?: string | null;
  accountName?: string | null;
}): Promise<{ accountId: string; accountName: string }> {
  const requested = (opts.requestedAccountId || '').trim();
  if (requested) {
    const account = await graphJson<InstagramAccount>(
      `${encodeURIComponent(requested)}?fields=id,username`,
      opts.accessToken,
    );
    return {
      accountId: account.id,
      accountName: account.username || opts.accountName?.trim() || account.id,
    };
  }

  const result = await graphJson<{ data?: FacebookPage[] }>(
    'me/accounts?fields=id,name,instagram_business_account{id,username}',
    opts.accessToken,
  );
  const pages = (result.data || []).filter((page) => page.instagram_business_account?.id);

  if (!pages.length) {
    throw new Error(
      'No Instagram Business/Creator account was found. Link Instagram to a Facebook Page and grant pages_show_list, pages_read_engagement, instagram_basic, and instagram_content_publish.',
    );
  }

  const wanted = (opts.accountName || '').trim().toLowerCase();
  const matching =
    pages.find(
      (page) =>
        page.name.toLowerCase() === wanted ||
        page.instagram_business_account?.username?.toLowerCase() === wanted.replace(/^@/, ''),
    ) || (pages.length === 1 ? pages[0] : undefined);

  if (!matching?.instagram_business_account?.id) {
    throw new Error(
      `Multiple Instagram accounts are available (${pages
        .map((page) => page.name)
        .join(', ')}). Enter the Instagram Business Account ID explicitly.`,
    );
  }

  return {
    accountId: matching.instagram_business_account.id,
    accountName:
      matching.instagram_business_account.username ||
      matching.name ||
      opts.accountName?.trim() ||
      matching.instagram_business_account.id,
  };
}

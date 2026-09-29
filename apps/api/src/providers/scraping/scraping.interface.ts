export interface CompetitorComment {
  author?: string;
  text: string;
}

export interface CompetitorPost {
  platform: string;
  handle: string;
  content: string;
  postUrl?: string;
  postedAt?: string;
  imageUrls?: string[];
  comments?: CompetitorComment[];
  engagement?: { likes?: number; comments?: number; shares?: number };
}

export interface ScrapingProvider {
  readonly name: string;
  scrapeProfile(platform: string, handle: string, profileUrl?: string): Promise<CompetitorPost[]>;
}

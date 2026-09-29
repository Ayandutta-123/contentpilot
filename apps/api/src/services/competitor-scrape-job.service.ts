import { randomUUID } from 'crypto';
import type { ProviderCreditAlert } from '../lib/provider-credits';
import {
  listScrapedCompetitorPosts,
  scrapeCompetitors,
  type ScrapedPostRow,
} from './competitor-monitor.service';

export type ScrapeJobStatus = 'running' | 'succeeded' | 'failed';

export type ScrapeJob = {
  id: string;
  tenantId: string;
  status: ScrapeJobStatus;
  competitorId?: string;
  message: string;
  scraped?: number;
  competitors?: number;
  posts?: ScrapedPostRow[];
  errors?: string[];
  error?: string;
  creditAlert?: ProviderCreditAlert;
  createdAt: number;
  finishedAt?: number;
};

const jobs = new Map<string, ScrapeJob>();

/** Drop finished jobs older than 1 hour to avoid unbounded growth. */
function gcJobs() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && (job.finishedAt || job.createdAt) < cutoff) {
      jobs.delete(id);
    }
  }
}

export function getScrapeJob(tenantId: string, jobId: string): ScrapeJob | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  return job;
}

export function startCompetitorScrapeJob(
  tenantId: string,
  opts?: { competitorId?: string; platforms?: string[] },
): ScrapeJob {
  gcJobs();
  const id = randomUUID();
  const job: ScrapeJob = {
    id,
    tenantId,
    status: 'running',
    competitorId: opts?.competitorId,
    message: 'Starting competitor scrape…',
    createdAt: Date.now(),
  };
  jobs.set(id, job);

  setImmediate(() => {
    void (async () => {
      try {
        const channelNote = opts?.platforms?.length
          ? ` (${opts.platforms.join(', ')})`
          : ' (all saved channels)';
        job.message = `Running scrape jobs${channelNote} — this can take 1–3 minutes…`;
        const data = await scrapeCompetitors(tenantId, {
          competitorId: opts?.competitorId,
          platforms: opts?.platforms,
        });
        job.status = 'succeeded';
        job.scraped = data.scraped;
        job.competitors = data.competitors;
        job.posts = data.posts;
        job.errors = data.errors;
        job.message =
          data.errors.length > 0
            ? `Finished with ${data.scraped} new post(s). ${data.errors.length} channel scrape(s) had errors.`
            : `Scraped ${data.scraped} new post(s) from ${data.competitors} competitor(s).`;
        job.finishedAt = Date.now();
      } catch (err) {
        const { reportIfCreditError } = await import('./provider-credit-alert.service');
        const credit = await reportIfCreditError(tenantId, err, 'scrape');
        job.status = 'failed';
        if (credit) {
          job.creditAlert = credit.toJSON();
          job.error = credit.message;
        } else {
          job.error = err instanceof Error ? err.message : String(err);
        }
        job.message = job.error;
        job.finishedAt = Date.now();
        try {
          job.posts = await listScrapedCompetitorPosts(tenantId, {
            competitorId: opts?.competitorId,
            limit: 50,
          });
        } catch {
          job.posts = [];
        }
      }
    })();
  });

  return job;
}

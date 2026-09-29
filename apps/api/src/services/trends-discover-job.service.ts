import { randomUUID } from 'crypto';
import type { ProviderCreditAlert } from '../lib/provider-credits';
import {
  candidateDedupeKey,
  loadTrendDiscoverContext,
  searchTopicTrends,
  type TrendCandidate,
} from './trends-discover.service';

export type TrendsDiscoverJobStatus = 'running' | 'succeeded' | 'failed';

export type TrendsDiscoverJob = {
  id: string;
  tenantId: string;
  status: TrendsDiscoverJobStatus;
  days: number;
  perTopic: number;
  message: string;
  /** Topics fully processed (success or per-topic error). */
  completedTopics: number;
  totalTopics: number;
  currentTopicName?: string;
  candidates: TrendCandidate[];
  /** Soft failures for individual topics (search kept going). */
  topicErrors: string[];
  error?: string;
  creditAlert?: ProviderCreditAlert;
  abortRequested: boolean;
  createdAt: number;
  finishedAt?: number;
};

const jobs = new Map<string, TrendsDiscoverJob>();

/** How many Tavily calls to run in parallel. */
const TOPIC_CONCURRENCY = 3;

function gcJobs() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && (job.finishedAt || job.createdAt) < cutoff) {
      jobs.delete(id);
    }
  }
}

export function getTrendsDiscoverJob(tenantId: string, jobId: string): TrendsDiscoverJob | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  return job;
}

export function cancelTrendsDiscoverJob(tenantId: string, jobId: string): TrendsDiscoverJob | null {
  const job = getTrendsDiscoverJob(tenantId, jobId);
  if (!job) return null;
  if (job.status === 'running') {
    job.abortRequested = true;
    job.message = `Cancel requested… keeping ${job.candidates.length} article(s) so far.`;
  }
  return job;
}

function bumpMessage(job: TrendsDiscoverJob, topicName?: string) {
  const n = job.candidates.length;
  const base = `Topic ${job.completedTopics}/${job.totalTopics}`;
  const cur = topicName || job.currentTopicName;
  job.message = cur
    ? `${base}: ${cur} (${n} article${n === 1 ? '' : 's'} so far)`
    : `${base} (${n} article${n === 1 ? '' : 's'} so far)`;
}

export function startTrendsDiscoverJob(
  tenantId: string,
  opts?: { days?: number; perTopic?: number },
): TrendsDiscoverJob {
  gcJobs();
  const id = randomUUID();
  const days = opts?.days ?? 7;
  const perTopic = opts?.perTopic ?? 5;
  const job: TrendsDiscoverJob = {
    id,
    tenantId,
    status: 'running',
    days,
    perTopic,
    message: 'Starting industry news search…',
    completedTopics: 0,
    totalTopics: 0,
    candidates: [],
    topicErrors: [],
    abortRequested: false,
    createdAt: Date.now(),
  };
  jobs.set(id, job);

  setImmediate(() => {
    void (async () => {
      try {
        const ctx = await loadTrendDiscoverContext(tenantId);
        job.totalTopics = ctx.topics.length;
        job.message = `Searching ${ctx.topics.length} topic(s)…`;

        const seen = new Set<string>();
        const seenIds = new Set<string>();
        let creditExhausted = false;

        for (let i = 0; i < ctx.topics.length; i += TOPIC_CONCURRENCY) {
          if (job.abortRequested || creditExhausted) {
            break;
          }

          const batch = ctx.topics.slice(i, i + TOPIC_CONCURRENCY);
          job.currentTopicName = batch.map((t) => t.name).join(', ');
          bumpMessage(job);

          const settled = await Promise.allSettled(
            batch.map((topic) => searchTopicTrends(ctx, topic, { days, perTopic })),
          );

          const { toProviderCreditError } = await import('../lib/provider-credits');
          const { reportIfCreditError } = await import('./provider-credit-alert.service');

          for (let b = 0; b < settled.length; b++) {
            const topic = batch[b]!;
            const result = settled[b]!;
            job.completedTopics += 1;

            if (result.status === 'fulfilled') {
              for (const c of result.value) {
                const key = candidateDedupeKey(c);
                if (seen.has(key) || seenIds.has(c.id)) continue;
                seen.add(key);
                seenIds.add(c.id);
                job.candidates.push(c);
              }
            } else {
              const credit = toProviderCreditError(result.reason, 'tavily', 'search');
              if (credit && !job.creditAlert) {
                const reported = await reportIfCreditError(tenantId, credit, 'search');
                job.creditAlert = (reported || credit).toJSON();
                creditExhausted = true;
                job.topicErrors.push(`${topic.name}: ${credit.message}`);
              } else {
                const msg =
                  result.reason instanceof Error ? result.reason.message : String(result.reason);
                job.topicErrors.push(`${topic.name}: ${msg}`);
              }
            }
          }

          bumpMessage(job, batch[batch.length - 1]?.name);
          if (creditExhausted) break;
        }

        if (job.abortRequested && !creditExhausted) {
          job.status = 'failed';
          job.error = `Cancelled after ${job.completedTopics}/${job.totalTopics} topics. Showing ${job.candidates.length} article(s) already found.`;
          job.message = job.error;
          job.finishedAt = Date.now();
          if (job.candidates.length) {
            const { persistTrendCandidates } = await import('./discover-scrape-store.service');
            await persistTrendCandidates(tenantId, job.candidates).catch(() => undefined);
          }
          return;
        }

        if (job.creditAlert) {
          job.status = 'failed';
          job.error =
            job.candidates.length > 0
              ? `${job.creditAlert.message} Showing ${job.candidates.length} article(s) already found.`
              : job.creditAlert.message;
          job.message = job.error;
        } else if (job.topicErrors.length > 0 && job.candidates.length === 0) {
          job.status = 'failed';
          job.error = `Search failed for all topics. ${job.topicErrors.slice(0, 3).join(' · ')}`;
          job.message = job.error;
        } else if (job.topicErrors.length > 0) {
          job.status = 'failed';
          job.error = `Finished with partial results: ${job.candidates.length} article(s) from ${job.completedTopics - job.topicErrors.length} topic(s). Failed: ${job.topicErrors.slice(0, 5).join(' · ')}${job.topicErrors.length > 5 ? ` (+${job.topicErrors.length - 5} more)` : ''}`;
          job.message = `Partial: ${job.candidates.length} article(s). ${job.topicErrors.length} topic(s) failed.`;
        } else {
          job.status = 'succeeded';
          job.message =
            job.candidates.length === 0
              ? 'No articles found for the selected window. Check Topics and search key in Settings.'
              : `Found ${job.candidates.length} article(s) across ${job.totalTopics} topic(s).`;
        }
        job.finishedAt = Date.now();
        if (job.candidates.length) {
          const { persistTrendCandidates } = await import('./discover-scrape-store.service');
          await persistTrendCandidates(tenantId, job.candidates).catch(() => undefined);
        }
      } catch (err) {
        const { reportIfCreditError } = await import('./provider-credit-alert.service');
        const credit = await reportIfCreditError(tenantId, err, 'search');
        job.status = 'failed';
        if (credit) {
          job.creditAlert = credit.toJSON();
          job.error = credit.message;
        } else {
          job.error = err instanceof Error ? err.message : String(err);
        }
        if (job.candidates.length > 0) {
          job.error = `${job.error} Showing ${job.candidates.length} article(s) already found from ${job.completedTopics} topic(s).`;
          const { persistTrendCandidates } = await import('./discover-scrape-store.service');
          await persistTrendCandidates(tenantId, job.candidates).catch(() => undefined);
        }
        job.message = job.error;
        job.finishedAt = Date.now();
      }
    })();
  });

  return job;
}

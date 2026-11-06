import { AiError, RateLimitError } from '@/ai/llm';
import { SourceShapeError } from '@/sources/types';

export type ErrorClass = { kind: 'wait'; seconds: number } | { kind: 'fatal'; message: string } | { kind: 'retry' } | { kind: 'give-up' };

// Errors that will never fix themselves by retrying: the whole run should end.
export const isFatalAiError = (e: unknown): boolean =>
  e instanceof AiError && (e.status === 401 || e.status === 403 || /is not set|Unknown AI_PROVIDER/.test(e.message));

export const MAX_ATTEMPTS = 3;

// How a failing workflow step should be handled.
// - a provider rate limit waits exactly as long as the provider asked, however many attempts that takes (free-tier quotas can be long)
// - a changed source page or a rejected/missing key ends the run
// - anything else gets a few retries and is then given up on, so one bad tender cannot burn the AI quota dozens of times a run
export function classifyError(e: unknown, attempt: number): ErrorClass {
  if (e instanceof RateLimitError) return { kind: 'wait', seconds: e.retryAfterSeconds };
  if (e instanceof SourceShapeError || isFatalAiError(e)) return { kind: 'fatal', message: (e as Error).message };
  return attempt > MAX_ATTEMPTS ? { kind: 'give-up' } : { kind: 'retry' };
}

import { FatalError, RetryableError } from 'workflow';
import { AiError, RateLimitError } from '@/ai/llm';
import { SourceShapeError } from '@/sources/types';
import { buildIo } from './io';
import type { RunIo } from './orchestrate';

// Maps our errors onto the Workflow SDK's retry semantics.
// - a provider rate limit becomes a durable wait of exactly the time the provider asked for (free-tier daily quotas can be minutes long)
// - a changed source page or a rejected API key will never fix itself, so they end the run
function toWorkflowError(e: unknown): never {
  if (e instanceof RateLimitError) throw new RetryableError(e.message, { retryAfter: e.retryAfterSeconds * 1000 });
  if (e instanceof SourceShapeError) throw new FatalError(e.message);
  if (e instanceof AiError && (e.status === 401 || e.status === 403 || /is not set|Unknown AI_PROVIDER/.test(e.message))) throw new FatalError(e.message);
  throw e;
}

async function markRunningStep(runId: number) {
  'use step';
  await buildIo().markRunning(runId);
}
async function listSourceIdsStep() {
  'use step';
  return buildIo().listSourceIds();
}
async function scanStep(runId: number, sourceId: string, limit: number) {
  'use step';
  try {
    return await buildIo().scan(runId, sourceId, limit);
  } catch (e) {
    return toWorkflowError(e);
  }
}
async function pendingIdsStep(limit: number) {
  'use step';
  return buildIo().pendingIds(limit);
}
async function shouldStopStep(runId: number) {
  'use step';
  return buildIo().shouldStop(runId);
}
async function screenStep(runId: number, ids: number[]) {
  'use step';
  try {
    await buildIo().screen(runId, ids);
  } catch (e) {
    toWorkflowError(e);
  }
}
screenStep.maxRetries = 40; // rate-limit waits count as retries
async function candidateIdsStep() {
  'use step';
  return buildIo().candidateIds();
}
async function analyseStep(runId: number, id: number) {
  'use step';
  try {
    await buildIo().analyse(runId, id);
  } catch (e) {
    toWorkflowError(e);
  }
}
analyseStep.maxRetries = 40;
async function logStep(runId: number, message: string) {
  'use step';
  await buildIo().log(runId, message);
}
async function finishStep(runId: number, status: 'completed' | 'failed' | 'cancelled', error?: string) {
  'use step';
  await buildIo().finish(runId, status, error);
}

export const stepIo: RunIo = {
  markRunning: markRunningStep,
  listSourceIds: listSourceIdsStep,
  scan: scanStep,
  pendingIds: pendingIdsStep,
  shouldStop: shouldStopStep,
  screen: screenStep,
  candidateIds: candidateIdsStep,
  analyse: analyseStep,
  log: logStep,
  finish: finishStep,
};

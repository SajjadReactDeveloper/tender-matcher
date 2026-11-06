import { FatalError, RetryableError, getStepMetadata } from 'workflow';
import { buildIo } from './io';
import { classifyError } from './errors';
import type { RunIo } from './orchestrate';

// Maps a failure onto the Workflow SDK's retry semantics (see classifyError). Returns normally only when the step should be given up on.
async function handleFailure(e: unknown, what: string, runId: number): Promise<void> {
  const c = classifyError(e, getStepMetadata().attempt);
  if (c.kind === 'wait') throw new RetryableError((e as Error).message, { retryAfter: c.seconds * 1000 });
  if (c.kind === 'fatal') throw new FatalError(c.message);
  if (c.kind === 'retry') throw e;
  await buildIo().log(runId, `Giving up on ${what} after repeated errors: ${(e as Error).message}`); // the run goes on; the next run retries it
}

async function markRunningStep(runId: number) {
  'use step';
  await buildIo().markRunning(runId);
}
async function listSourceIdsStep() {
  'use step';
  return buildIo().listSourceIds();
}
async function scanPageStep(runId: number, sourceId: string, page: number, remaining: number) {
  'use step';
  try {
    return await buildIo().scanPage(runId, sourceId, page, remaining);
  } catch (e) {
    await handleFailure(e, `${sourceId} page ${page}`, runId);
    return { added: 0, pages: null, done: true }; // given up: end this source's scan rather than loop on a broken page
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
    await handleFailure(e, `screening ${ids.length} tenders`, runId);
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
    await handleFailure(e, `tender ${id}`, runId);
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
  scanPage: scanPageStep,
  pendingIds: pendingIdsStep,
  shouldStop: shouldStopStep,
  screen: screenStep,
  candidateIds: candidateIdsStep,
  analyse: analyseStep,
  log: logStep,
  finish: finishStep,
};

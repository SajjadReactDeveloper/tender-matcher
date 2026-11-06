import { appendLog, finishRun, isStopRequested, markRunning } from '@/db/queries';
import { candidateIds, pendingIds } from '@/db/tenders';
import type { RunIo } from './orchestrate';
import { analyseTender, defaultDeps, scanPage, screenIds, type PipelineDeps } from './pipeline';

// The plain (non-workflow) implementation of RunIo. steps.ts wraps these same calls as durable steps.
export function buildIo(deps: PipelineDeps = defaultDeps()): RunIo {
  return {
    markRunning,
    listSourceIds: async () => deps.sources.map((s) => s.id),
    scanPage: (runId, sourceId, page, remaining) => scanPage(runId, sourceId, page, remaining, deps),
    pendingIds,
    shouldStop: isStopRequested,
    screen: async (runId, ids) => void (await screenIds(runId, ids, deps)),
    candidateIds,
    analyse: (runId, id) => analyseTender(runId, id, deps),
    log: appendLog,
    finish: finishRun,
  };
}

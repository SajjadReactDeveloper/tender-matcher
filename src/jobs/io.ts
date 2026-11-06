import { appendLog, finishRun, isStopRequested, markRunning } from '@/db/queries';
import { candidateIds, pendingIds } from '@/db/tenders';
import type { RunIo } from './orchestrate';
import { analyseTender, defaultDeps, scanSource, screenIds, type PipelineDeps } from './pipeline';

// The plain (non-workflow) implementation of RunIo. steps.ts wraps these same calls as durable steps.
export function buildIo(deps: PipelineDeps = defaultDeps()): RunIo {
  return {
    markRunning,
    listSourceIds: async () => deps.sources.map((s) => s.id),
    scan: (runId, sourceId, limit) => scanSource(runId, sourceId, limit, deps),
    pendingIds,
    shouldStop: isStopRequested,
    screen: async (runId, ids) => void (await screenIds(runId, ids, deps)),
    candidateIds,
    analyse: (runId, id) => analyseTender(runId, id, deps),
    log: appendLog,
    finish: finishRun,
  };
}

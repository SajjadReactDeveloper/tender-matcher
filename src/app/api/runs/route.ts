import { start } from 'workflow/api';
import { z } from 'zod';
import { pruneAudit } from '@/audit/store';
import { createRun, finishRun, getCurrentRun, setWorkflowRunId } from '@/db/queries';
import { fetchRunWorkflow } from '@/jobs/fetch-run';
import { requireSession } from '@/lib/auth/require-session';
import { HttpError, assertSameOrigin, errorResponse, rateLimit, readJsonBody } from '@/lib/security';

const body = z.object({ limit: z.number().int().min(1).max(3000).default(150) });

export async function POST(req: Request): Promise<Response> {
  try {
    await requireSession(req);
    assertSameOrigin(req);
    rateLimit('runs:start', 5);
    const parsed = body.safeParse(await readJsonBody(req));
    if (!parsed.success) throw new HttpError(400, '"limit" must be a whole number from 1 to 3000');
    const { limit } = parsed.data;

    const run = await createRun(limit); // 409 if a run is already active
    void pruneAudit(); // keep the audit tables to 180 days; never blocks or fails the run
    try {
      const wf = await start(fetchRunWorkflow, [run.id, limit]);
      await setWorkflowRunId(run.id, wf.runId);
    } catch (e) {
      await finishRun(run.id, 'failed', 'Could not start the background job'); // never leave a stuck active run behind
      throw e;
    }
    return Response.json({ runId: run.id });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    await requireSession(req);
    return Response.json((await getCurrentRun()) ?? { run: null, logs: [] });
  } catch (e) {
    return errorResponse(e);
  }
}

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createRun, getCurrentRun, markRunning } from '@/db/queries';
import { createTestDb } from '../helpers/test-db';
import { signedIn } from '../helpers/auth';

vi.mock('workflow/api', () => ({ start: async () => ({ runId: 'wf_1' }) }));

let auth = {} as { cookie: string };
const stop = () => new Request('http://localhost:3000/api/runs/stop', { method: 'POST', headers: { host: 'localhost:3000', ...auth } });

async function route() {
  const db = await createTestDb();
  vi.resetModules();
  (await import('@/db/client')).setDb(db);
  return import('@/app/api/runs/stop/route');
}

beforeEach(async () => {
  vi.clearAllMocks();
  auth = await signedIn();
});

describe('POST /api/runs/stop on a run whose workflow is lost', () => {
  test('the first Stop asks politely; a second Stop force-cancels the run so Fetch works again', async () => {
    const { POST } = await route();
    const run = await createRun(5);
    await markRunning(run.id);

    const first = await POST(stop());
    expect(await first.json()).toEqual({ ok: true, forced: false });
    expect((await getCurrentRun())?.run.status).toBe('running'); // waiting for the workflow to notice

    const second = await POST(stop());
    expect(await second.json()).toEqual({ ok: true, forced: true });
    expect((await getCurrentRun())?.run).toMatchObject({ status: 'cancelled', error: 'Stopped manually' });

    await expect(createRun(5)).resolves.toMatchObject({ status: 'queued' }); // not blocked any more
  });

  test('a force-stopped run is closed with a finish time, and Stop with nothing running is still a 409', async () => {
    const { POST } = await route();
    expect((await POST(stop())).status).toBe(409);
    const run = await createRun(5);
    await POST(stop());
    await POST(stop());
    expect((await getCurrentRun())?.run.finishedAt).not.toBeNull();
    expect(run.id).toBeGreaterThan(0);
  });
});

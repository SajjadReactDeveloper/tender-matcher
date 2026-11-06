import { describe, expect, test } from 'vitest';
import { orchestrate, type RunIo } from '@/jobs/orchestrate';

// A scripted io that records every call; `ids` are pending ids, `cands` the ids that pass screening.
function io(over: Partial<RunIo> = {}, ids = [1, 2, 3], cands = [2, 3]) {
  const calls: string[] = [];
  const base: RunIo = {
    markRunning: async () => void calls.push('running'),
    listSourceIds: async () => ['a', 'b'],
    scan: async (_r, s) => { calls.push(`scan:${s}`); return 1; },
    pendingIds: async () => ids,
    shouldStop: async () => false,
    screen: async (_r, batch) => void calls.push(`screen:${batch.join(',')}`),
    candidateIds: async () => cands,
    analyse: async (_r, id) => void calls.push(`analyse:${id}`),
    log: async (_r, m) => void calls.push(`log:${m}`),
    finish: async (_r, status, error) => void calls.push(`finish:${status}${error ? ':' + error : ''}`),
  };
  return { calls, io: { ...base, ...over } };
}

describe('orchestrate', () => {
  test('scans every source, screens pending in batches of 20, analyses candidates, then completes', async () => {
    const t = io({}, Array.from({ length: 45 }, (_, i) => i + 1));
    await orchestrate(t.io, 7, 100);
    expect(t.calls.filter((c) => c.startsWith('screen:')).map((c) => c.split(',').length)).toEqual([20, 20, 5]);
    expect(t.calls).toEqual(expect.arrayContaining(['running', 'scan:a', 'scan:b', 'analyse:2', 'analyse:3', 'finish:completed']));
    expect(t.calls.at(-1)).toBe('finish:completed');
  });

  test('a stop request ends the run as cancelled before the next unit of work', async () => {
    let checks = 0;
    const t = io({ shouldStop: async () => ++checks > 2 });
    await orchestrate(t.io, 7, 100);
    expect(t.calls.at(-1)).toBe('finish:cancelled');
    expect(t.calls.filter((c) => c.startsWith('analyse:'))).toHaveLength(0);
  });

  test('an error from a source fails the run with that message', async () => {
    const t = io({ scan: async () => { throw new Error('source returned no tenders'); } });
    await orchestrate(t.io, 7, 100);
    expect(t.calls.at(-1)).toBe('finish:failed:source returned no tenders');
  });

  test('one tender failing to analyse is logged and the rest still run', async () => {
    const t = io({ analyse: async (_r, id) => { if (id === 2) throw new Error('bad pdf'); } });
    await orchestrate(t.io, 7, 100);
    expect(t.calls.some((c) => c.startsWith('log:') && c.includes('bad pdf'))).toBe(true);
    expect(t.calls.at(-1)).toBe('finish:completed');
  });

  test('a FatalError (for example a bad API key) stops the whole run as failed', async () => {
    const fatal = Object.assign(new Error('GROQ_API_KEY is not set'), { name: 'FatalError' });
    const t = io({ analyse: async () => { throw fatal; } });
    await orchestrate(t.io, 7, 100);
    expect(t.calls.at(-1)).toBe('finish:failed:GROQ_API_KEY is not set');
    expect(t.calls.filter((c) => c.startsWith('analyse:')).length).toBe(0);
  });
});

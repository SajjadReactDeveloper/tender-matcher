import { describe, expect, test } from 'vitest';
import { orchestrate, type RunIo } from '@/jobs/orchestrate';

// A scripted io that records every call; `ids` are pending ids, `cands` the ids that pass screening.
// scanPage reports 2 pages on page 1 and adds 1 tender per page unless overridden.
function io(over: Partial<RunIo> = {}, ids = [1, 2, 3], cands = [2, 3]) {
  const calls: string[] = [];
  const base: RunIo = {
    markRunning: async () => void calls.push('running'),
    listSourceIds: async () => ['a', 'b'],
    scanPage: async (_r, s, page) => {
      calls.push(`scan:${s}:${page}`);
      return { added: 1, pages: page === 1 ? 2 : null, done: false };
    },
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
  test('scans every source page by page, screens pending in batches of 20, analyses candidates, then completes', async () => {
    const t = io({}, Array.from({ length: 45 }, (_, i) => i + 1));
    await orchestrate(t.io, 7, 100);
    expect(t.calls.filter((c) => c.startsWith('scan:'))).toEqual(['scan:a:1', 'scan:a:2', 'scan:b:1', 'scan:b:2']);
    expect(t.calls.filter((c) => c.startsWith('screen:')).map((c) => c.split(',').length)).toEqual([20, 20, 5]);
    expect(t.calls).toEqual(expect.arrayContaining(['running', 'analyse:2', 'analyse:3', 'finish:completed']));
    expect(t.calls.at(-1)).toBe('finish:completed');
  });

  test('stops paging a source once `limit` new tenders were found, and when a page says the listing is done', async () => {
    const t1 = io({ listSourceIds: async () => ['a'], scanPage: async (_r, s, page) => (t1.calls.push(`scan:${s}:${page}`), { added: 1, pages: 9, done: false }) });
    await orchestrate(t1.io, 7, 3);
    expect(t1.calls.filter((c) => c.startsWith('scan:'))).toEqual(['scan:a:1', 'scan:a:2', 'scan:a:3']);

    const t2 = io({ listSourceIds: async () => ['a'], scanPage: async (_r, s, page) => (t2.calls.push(`scan:${s}:${page}`), { added: 0, pages: 9, done: page === 2 }) });
    await orchestrate(t2.io, 7, 100);
    expect(t2.calls.filter((c) => c.startsWith('scan:'))).toEqual(['scan:a:1', 'scan:a:2']);
  });

  test('a stop request between listing pages ends the run as cancelled', async () => {
    let checks = 0;
    const t = io({ listSourceIds: async () => ['a'], shouldStop: async () => ++checks > 2 });
    await orchestrate(t.io, 7, 100);
    expect(t.calls.at(-1)).toBe('finish:cancelled');
    expect(t.calls.filter((c) => c.startsWith('screen:'))).toHaveLength(0);
  });

  test('a stop request ends the run as cancelled before the next unit of work', async () => {
    let checks = 0;
    const t = io({ shouldStop: async () => ++checks > 4 });
    await orchestrate(t.io, 7, 100);
    expect(t.calls.at(-1)).toBe('finish:cancelled');
    expect(t.calls.filter((c) => c.startsWith('analyse:'))).toHaveLength(0);
  });

  test('an error from a source fails the run with that message', async () => {
    const t = io({ scanPage: async () => { throw new Error('source returned no tenders'); } });
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
  });
});

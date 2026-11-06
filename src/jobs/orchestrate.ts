// Pure control flow for a fetch run. Every unit of work is an injected function (a workflow step in production),
// so this file must stay free of Node APIs: it runs inside the workflow sandbox.
export interface ScanPageResult {
  added: number;
  pages: number | null; // total listing pages, reported by page 1 only
  done: boolean; // the listing has no more rows
}

export interface RunIo {
  markRunning(runId: number): Promise<void>;
  listSourceIds(): Promise<string[]>;
  scanPage(runId: number, sourceId: string, page: number, remaining: number): Promise<ScanPageResult>;
  pendingIds(limit: number): Promise<number[]>;
  shouldStop(runId: number): Promise<boolean>;
  screen(runId: number, ids: number[]): Promise<void>;
  candidateIds(): Promise<number[]>;
  analyse(runId: number, id: number): Promise<void>;
  log(runId: number, message: string): Promise<void>;
  finish(runId: number, status: 'completed' | 'failed' | 'cancelled', error?: string): Promise<void>;
}

const BATCH = 20;
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function orchestrate(io: RunIo, runId: number, limit: number): Promise<void> {
  try {
    await io.markRunning(runId);
    for (const sourceId of await io.listSourceIds()) {
      // One workflow step per listing page: each stays short and Stop is honoured between pages.
      let remaining = limit;
      let pages = Infinity;
      for (let page = 1; remaining > 0 && page <= pages; page++) {
        if (await io.shouldStop(runId)) return await io.finish(runId, 'cancelled');
        const r = await io.scanPage(runId, sourceId, page, remaining);
        if (r.pages !== null) pages = r.pages;
        remaining -= r.added;
        if (r.done) break;
      }
    }

    const pending = await io.pendingIds(limit);
    for (let i = 0; i < pending.length; i += BATCH) {
      if (await io.shouldStop(runId)) return await io.finish(runId, 'cancelled');
      await io.screen(runId, pending.slice(i, i + BATCH));
    }

    const candidates = await io.candidateIds();
    await io.log(runId, `Reading documents and scoring ${candidates.length} candidates...`);
    for (const id of candidates) {
      if (await io.shouldStop(runId)) return await io.finish(runId, 'cancelled');
      try {
        await io.analyse(runId, id);
      } catch (e) {
        if ((e as Error)?.name === 'FatalError') throw e; // for example a bad API key: no point continuing
        await io.log(runId, `Tender ${id} failed, will retry next run: ${message(e)}`);
      }
    }
    await io.finish(runId, 'completed');
  } catch (e) {
    await io.finish(runId, 'failed', message(e));
  }
}

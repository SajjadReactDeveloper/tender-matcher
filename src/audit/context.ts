import { AsyncLocalStorage } from 'node:async_hooks';

// Which run and tender the code below is working on, so llm.ts and http.ts can record themselves without extra parameters.
export interface AuditCtx {
  runId?: number;
  tender?: string;
}

const store = new AsyncLocalStorage<AuditCtx>();

export const withAudit = <T>(ctx: AuditCtx, fn: () => Promise<T>): Promise<T> => store.run({ ...store.getStore(), ...ctx }, fn);
export const getAudit = (): AuditCtx => store.getStore() ?? {};

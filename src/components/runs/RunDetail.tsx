'use client';

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { useApi } from '../useApi';
import { clock, duration, ms, num, stamp } from '../fmt';

interface AiCall {
  id: number;
  at: string;
  purpose: string;
  provider: string;
  model: string;
  status: string;
  tenderExternalId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  retryAfterS: number | null;
  error: string | null;
}
interface Ev {
  id: number;
  at: string;
  category: string;
  action: string;
  status: string;
  ref: string | null;
  durationMs: number | null;
  details: Record<string, unknown> | null;
}
interface Detail {
  run: { id: number; status: string; limit: number; startedAt: string; finishedAt: string | null; error: string | null; screened: number; matched: number };
  logs: { at: string; message: string }[];
  aiCalls: AiCall[];
  events: Ev[];
}

interface Line {
  at: string;
  kind: 'log' | 'ai' | 'fetch';
  text: string;
}

const short = (u: unknown) => String(u ?? '').replace(/^https?:\/\//, '').slice(0, 70);

// One time-ordered story of the run: its log lines, each AI call with tokens, and each request to the tender site.
function timeline(d: Detail): Line[] {
  const lines: Line[] = d.logs.map((l) => ({ at: l.at, kind: 'log', text: l.message.trim() }));
  for (const c of d.aiCalls) {
    const toks = c.inputTokens == null ? 'tokens n/a' : `${num(c.inputTokens)} in, ${num(c.outputTokens)} out`;
    const what = c.status === 'rate_limited' ? `rate limited, wait ${c.retryAfterS ?? '?'}s` : c.status === 'error' ? `failed: ${c.error ?? 'error'}` : toks;
    lines.push({ at: c.at, kind: 'ai', text: `${c.purpose} ${c.tenderExternalId ?? ''} with ${c.model}: ${what} (${ms(c.latencyMs)})` });
  }
  for (const e of d.events.filter((x) => x.category === 'fetch')) {
    const det = e.details ?? {};
    lines.push({ at: e.at, kind: 'fetch', text: `${short(det.url)} ${e.status === 'ok' ? `${det.status} ${num(det.bytes as number)} bytes` : `failed: ${det.error ?? det.status}`} (${ms(e.durationMs)})` });
  }
  return lines.sort((a, b) => a.at.localeCompare(b.at));
}

export function RunDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<Detail>(`/api/history/${encodeURIComponent(id)}`);
  const running = data?.run.status === 'running' || data?.run.status === 'queued';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, 5000); // follow a run that is still going
    return () => clearInterval(t);
  }, [running, reload]);
  const lines = useMemo(() => (data ? timeline(data) : []), [data]);
  const totals = useMemo(() => {
    const ai = data?.aiCalls ?? [];
    return { calls: ai.length, input: ai.reduce((a, c) => a + (c.inputTokens ?? 0), 0), output: ai.reduce((a, c) => a + (c.outputTokens ?? 0), 0), limited: ai.filter((c) => c.status === 'rate_limited').length };
  }, [data]);

  if (error) {
    return (
      <>
        <Link href="/runs" className="crumb">Back to runs</Link>
        <section className="card empty error">
          <b>{error === 'Run not found' ? 'That run does not exist' : 'Could not load this run'}</b>
          {error}
        </section>
      </>
    );
  }
  if (loading || !data) return <span className="sk" style={{ height: 120 }} aria-label="Loading" />;
  const { run } = data;
  const dur = run.finishedAt ? Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000) : null;

  return (
    <>
      <Link href="/runs" className="crumb">Back to runs</Link>
      <div className="page-head">
        <div>
          <h1>Run #{run.id}</h1>
          <p>
            <span className={`status ${run.status}`}>{run.status}</span> started {stamp(run.startedAt)}
            {dur != null && `, took ${duration(dur)}`}. Limit {num(run.limit)} new tenders.
          </p>
        </div>
      </div>
      {run.error && <p className="notice" role="alert">{run.error}</p>}
      <section className="card stats" aria-label="Run totals">
        <div className="stat"><b>{num(run.screened)}</b><span>Screened</span></div>
        <div className="stat"><b>{num(run.matched)}</b><span>Matched</span></div>
        <div className="stat"><b>{num(totals.calls)}</b><span>AI calls</span><small>{totals.limited} rate-limited</small></div>
        <div className="stat"><b>{totals.calls ? num(totals.input + totals.output) : 'n/a'}</b><span>Tokens</span><small>{num(totals.input)} in, {num(totals.output)} out</small></div>
      </section>
      <section className="card" style={{ marginTop: 18 }}>
        <div className="card-head">
          <h2>Timeline</h2>
          <p>Log lines, AI calls and requests to the tender site, in order</p>
        </div>
        {lines.length === 0 ? (
          <div className="empty">Nothing was recorded for this run.</div>
        ) : (
          <ol className="timeline">
            {lines.map((l, i) => (
              <li key={i}>
                <span className="when">{clock(l.at)}</span>
                <span className={`kind ${l.kind}`}>{l.kind === 'log' ? 'Log' : l.kind === 'ai' ? 'AI call' : 'Request'}</span>
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

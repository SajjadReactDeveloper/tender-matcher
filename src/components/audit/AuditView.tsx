'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api-client';
import { ms, num, stamp, usd } from '../fmt';

type Kind = 'ai' | 'events';

interface AiRow {
  id: number;
  at: string;
  runId: number | null;
  tenderExternalId: string | null;
  purpose: string;
  provider: string;
  model: string;
  status: string;
  httpStatus: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  images: number;
  latencyMs: number;
  retryAfterS: number | null;
  estCostUsd: string | null;
  error: string | null;
  promptPreview: string | null;
  replyPreview: string | null;
}
interface EventRow {
  id: number;
  at: string;
  category: string;
  action: string;
  status: string;
  runId: number | null;
  ref: string | null;
  durationMs: number | null;
  details: unknown;
}
type Row = AiRow | EventRow;
type Page = { rows: Row[]; next: number | null };

const CATEGORIES = ['fetch', 'run', 'settings', 'auth'];
const STATUSES: Record<Kind, string[]> = { ai: ['ok', 'rate_limited', 'error'], events: ['ok', 'error', 'info'] };

export function AuditView() {
  const [kind, setKind] = useState<Kind>('ai');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [runId, setRunId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const seq = useRef(0);

  const query = useCallback(
    (before?: number) => {
      const p = new URLSearchParams({ kind });
      if (kind === 'events' && category) p.set('category', category);
      if (status) p.set('status', status);
      if (q.trim()) p.set('q', q.trim());
      if (runId.trim()) p.set('runId', runId.trim());
      if (before) p.set('before', String(before));
      return p;
    },
    [kind, category, status, q, runId],
  );

  const load = useCallback(
    async (before?: number) => {
      const mine = ++seq.current; // only the newest request may update the table
      setLoading(true);
      try {
        const page = (await (await api(`/api/audit?${query(before)}`)).json()) as Page;
        if (mine !== seq.current) return;
        setRows((cur) => (before ? [...cur, ...page.rows] : page.rows));
        setNext(page.next);
        setError('');
      } catch (e) {
        if (mine === seq.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0); // wait for the person to stop typing before searching
    return () => clearTimeout(t);
  }, [load, q]);

  const exportHref = `/api/audit/export?${query()}`;
  const cols = kind === 'ai' ? 10 : 7;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>Every AI call and every action the app took. Entries cannot be edited or deleted here and are kept for 180 days.</p>
        </div>
        <div className="controls">
          <a className="btn" href={exportHref} download>
            Export CSV
          </a>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Audit log type">
        {(['ai', 'events'] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => {
              setKind(k);
              setStatus('');
              setCategory('');
              setOpen(null);
            }}
          >
            {k === 'ai' ? 'AI calls' : 'Events'}
          </button>
        ))}
      </div>

      <div className="toolbar">
        {kind === 'events' && (
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {STATUSES[kind].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input type="number" min={1} placeholder="Run #" aria-label="Run number" value={runId} onChange={(e) => setRunId(e.target.value)} style={{ width: 96 }} />
        <input type="search" placeholder={kind === 'ai' ? 'Search model, tender or purpose' : 'Search action, reference or details'} aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <section className="card">
        {error ? (
          <div className="empty error">
            <b>Could not load the audit log</b>
            {error}
            <br />
            <button type="button" className="btn" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="card-body">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="sk" style={{ height: 18, margin: '14px 0' }} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <b>Nothing matches</b>
            Change the filters, or run a fetch to create entries.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                {kind === 'ai' ? (
                  <tr>
                    <th>Time</th>
                    <th>Purpose</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th className="num">Tokens in</th>
                    <th className="num">Tokens out</th>
                    <th className="num">Latency</th>
                    <th className="num">Est. cost</th>
                    <th>Run</th>
                    <th>Tender</th>
                  </tr>
                ) : (
                  <tr>
                    <th>Time</th>
                    <th>Category</th>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Reference</th>
                    <th>Run</th>
                    <th className="num">Duration</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr
                      className="click"
                      tabIndex={0}
                      aria-label={`${open === r.id ? 'Hide' : 'Show'} details`}
                      onClick={() => setOpen(open === r.id ? null : r.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setOpen(open === r.id ? null : r.id);
                        }
                      }}
                    >
                      {kind === 'ai' ? <AiCells r={r as AiRow} /> : <EventCells r={r as EventRow} />}
                    </tr>
                    {open === r.id && (
                      <tr className="detail-row">
                        <td colSpan={cols}>{kind === 'ai' ? <AiDetail r={r as AiRow} /> : <EventDetail r={r as EventRow} />}</td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {next && (
          <div className="more">
            <button type="button" className="btn" disabled={loading} onClick={() => void load(next)}>
              {loading ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

function AiCells({ r }: { r: AiRow }) {
  return (
    <>
      <td className="nowrap">{stamp(r.at)}</td>
      <td>{r.purpose}</td>
      <td>
        {r.model}
        <br />
        <span className="muted">{r.provider}</span>
      </td>
      <td>
        <span className={`status ${r.status}`}>{r.status.replace('_', ' ')}</span>
      </td>
      <td className="num">{num(r.inputTokens)}</td>
      <td className="num">{num(r.outputTokens)}</td>
      <td className="num">{ms(r.latencyMs)}</td>
      <td className="num">{usd(r.estCostUsd)}</td>
      <td>{r.runId ? `#${r.runId}` : ''}</td>
      <td>{r.tenderExternalId ?? ''}</td>
    </>
  );
}

function EventCells({ r }: { r: EventRow }) {
  return (
    <>
      <td className="nowrap">{stamp(r.at)}</td>
      <td>{r.category}</td>
      <td>{r.action}</td>
      <td>
        <span className={`status ${r.status}`}>{r.status}</span>
      </td>
      <td>{r.ref ?? ''}</td>
      <td>{r.runId ? `#${r.runId}` : ''}</td>
      <td className="num">{ms(r.durationMs)}</td>
    </>
  );
}

function AiDetail({ r }: { r: AiRow }) {
  return (
    <>
      <dl className="kv">
        <dt>HTTP status</dt>
        <dd>{r.httpStatus ?? 'n/a'}</dd>
        <dt>Total tokens</dt>
        <dd>{num(r.totalTokens)}</dd>
        <dt>Page images</dt>
        <dd>{r.images}</dd>
        {r.retryAfterS != null && (<><dt>Wait asked</dt><dd>{r.retryAfterS} s</dd></>)}
        {r.error && (<><dt>Error</dt><dd>{r.error}</dd></>)}
      </dl>
      {r.promptPreview && (<><b>Prompt (first 4,000 characters)</b><pre className="code">{r.promptPreview}</pre></>)}
      {r.replyPreview && (<><b>Reply</b><pre className="code">{r.replyPreview}</pre></>)}
    </>
  );
}

function EventDetail({ r }: { r: EventRow }) {
  return r.details ? <pre className="code">{JSON.stringify(r.details, null, 2)}</pre> : <span className="muted">No further details.</span>;
}

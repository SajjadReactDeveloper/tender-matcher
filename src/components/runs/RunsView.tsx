'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Pagination } from '../Pagination';
import { useApi } from '../useApi';
import { duration, num, stamp, usd } from '../fmt';

export interface RunRow {
  id: number;
  status: string;
  limit: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  screened: number;
  matched: number;
  aiCalls: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  durationSec: number | null;
}

export function RunsView() {
  const { data, error, loading, reload } = useApi<{ runs: RunRow[] }>('/api/history');
  const router = useRouter();
  const all = data?.runs ?? [];
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const page = Math.min(pageNo, Math.max(1, Math.ceil(all.length / pageSize)));
  const runs = all.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Runs</h1>
          <p>Every fetch, with what it read and what the AI used.</p>
        </div>
      </div>
      <section className="card">
        {error ? (
          <div className="empty error">
            <b>Could not load runs</b>
            {error}
            <br />
            <button type="button" className="btn" onClick={reload}>
              Try again
            </button>
          </div>
        ) : loading && !data ? (
          <div className="card-body">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="sk" style={{ height: 18, margin: '14px 0' }} />
            ))}
          </div>
        ) : all.length === 0 ? (
          <div className="empty">
            <b>No runs yet</b>
            Press Fetch latest tenders on the Tenders page to start one.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th className="num">Duration</th>
                  <th className="num">Screened</th>
                  <th className="num">Matched</th>
                  <th className="num">AI calls</th>
                  <th className="num">Tokens in</th>
                  <th className="num">Tokens out</th>
                  <th className="num">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="click" onClick={() => router.push(`/runs/${r.id}`)}>
                    <td>
                      <Link href={`/runs/${r.id}`} onClick={(e) => e.stopPropagation()}>
                        #{r.id}
                      </Link>
                    </td>
                    <td>
                      <span className={`status ${r.status}`}>{r.status}</span>
                    </td>
                    <td className="nowrap">{stamp(r.startedAt)}</td>
                    <td className="num">{duration(r.durationSec)}</td>
                    <td className="num">{num(r.screened)}</td>
                    <td className="num">{num(r.matched)}</td>
                    <td className="num">{num(r.aiCalls)}</td>
                    <td className="num">{r.aiCalls ? num(r.inputTokens) : 'n/a'}</td>
                    <td className="num">{r.aiCalls ? num(r.outputTokens) : 'n/a'}</td>
                    <td className="num">{r.aiCalls && r.estCostUsd > 0 ? usd(r.estCostUsd) : 'n/a'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Pagination total={all.length} page={page} pageSize={pageSize} noun="runs" onPage={setPageNo} onPageSize={(n) => { setPageSize(n); setPageNo(1); }} />
    </>
  );
}

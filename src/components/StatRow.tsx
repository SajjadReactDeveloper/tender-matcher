'use client';

import { useEffect, useState } from 'react';
import type { TenderView } from '@/domain/types';
import { api } from './api-client';
import { ago, num, usd } from './fmt';
import { daysLeft, isOpen } from './format';
import { isActive, type RunSummary } from './RunBar';

interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
}

type Props = { tenders: TenderView[]; run: (RunSummary & { finishedAt?: string | null; startedAt?: string }) | null; loading: boolean };

// A quiet row of plain figures, not a wall of cards: the closing runway below it is the page's main picture.
export function StatRow({ tenders, run, loading }: Props) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const active = isActive(run);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api('/api/usage?hours=24')
        .then((r) => r.json())
        .then((u) => live && setUsage(u as Usage))
        .catch(() => {});
    }, 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [run?.id, run?.status, run?.matched]);

  const open = tenders.filter(isOpen);
  const soon = open.filter((t) => t.lastDate && daysLeft(t.lastDate) <= 7);
  const scored = open.filter((t) => t.score > 0);
  const avg = scored.length ? Math.round(scored.reduce((a, t) => a + t.score, 0) / scored.length) : null;
  const dash = loading ? '' : undefined;

  return (
    <section className="card stats" aria-label="Summary">
      <div className="stat">
        <b>{dash ?? open.length}</b>
        <span>Open matches</span>
        <small>{loading ? '' : `${tenders.length - open.length} already closed`}</small>
      </div>
      <div className="stat">
        <b>{dash ?? soon.length}</b>
        <span>Closing within 7 days</span>
      </div>
      <div className="stat">
        <b>{dash ?? (avg ?? 'n/a')}</b>
        <span>Average fit score</span>
      </div>
      <div className="stat">
        <b>{run ? (active ? 'Running' : run.status[0].toUpperCase() + run.status.slice(1)) : 'None'}</b>
        <span>Last fetch</span>
        <small>{run ? ago(run.finishedAt ?? run.startedAt) : 'Press Fetch to start'}</small>
      </div>
      <div className="stat">
        <b>{usage ? num(usage.inputTokens + usage.outputTokens) : ''}</b>
        <span>AI tokens, last 24 h</span>
        <small>{usage ? `${num(usage.inputTokens)} in, ${num(usage.outputTokens)} out, ${usd(usage.estCostUsd || null)}` : ''}</small>
      </div>
    </section>
  );
}
